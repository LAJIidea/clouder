import * as types from "open-collaboration-protocol";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";

import { Disposable, DisposableCollection, Emitter, Event, MessageService, URI, nls } from "@theia/core";
import { Container, inject, injectable, interfaces, postConstruct } from "@theia/core/shared/inversify";
import { ApplicationShell } from "@theia/core/lib/browser/shell/application-shell";
import { EditorManager } from "@theia/editor/lib/browser/editor-manager";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { MonacoTextModelService } from "@theia/monaco/lib/browser/monaco-text-model-service";
import { CollaborationWorkspaceService } from "./collaboration-workspace-service";
import { Range as MonacoRange } from "@theia/monaco-editor-core";
import { MonacoEditor } from "@theia/monaco/lib/browser/monaco-editor";
import { Deferred } from "@theia/core/lib/common/promise-util";
import { EditorDecoration, EditorWidget, TextEditorDocument } from "@theia/editor/lib/browser";
import { DecorationStyle, OpenerService } from "@theia/core/lib/browser";
import { CollaborationFileSystemProvider, CollaborationURI } from "./collaboration-file-system-provider";
import { Range } from "@theia/core/shared/vscode-languageserver-protocol";
import { BinaryBuffer } from "@theia/core/lib/common/buffer";
import { FileChange, FileChangeType, FileOperation } from "@theia/filesystem/lib/common/files";
import { OpenCollabYjsProvider } from "./yjs-provider";
import { createMutex } from "lib0/mutex";
import { CollaborationUtils } from "./collaboration-utils";
import throttle = require('@theia/core/shared/lodash.throttle');
import { CollaborationColorService } from "./collaboration-color-service";
import { MonacoEditorModel } from "@theia/monaco/lib/browser/monaco-editor-model";

export interface Selection extends Range {
  direction: 'ltr' | 'rtl';
}

export const CollaborationInstanceFactory = Symbol('CollaborationInstanceFactory');
export type CollaborationInstanceFactory = (connection: CollaborationInstanceOptions) => CollaborationInstance;

export const CollaborationInstanceOptions = Symbol('CollborationInstanceOptions');
export interface CollaborationInstanceOptions {
  role: 'host' | 'guest';
  connection: types.ProtocolBroadcastConnection;
}

export function createCollaborationInstanceContainer(parent: interfaces.Container, options: CollaborationInstanceOptions): Container {
  const child = new Container();
  child.parent = parent;
  child.bind(CollaborationInstance).toSelf().inTransientScope();
  child.bind(CollaborationInstanceOptions).toConstantValue(options);
  return child;
}

export class CollaborationPeer implements types.Peer, Disposable {
  id: string;
  host: boolean;
  name: string;
  email?: string | undefined;

  constructor(peer: types.Peer, protected disposable: Disposable) {
    this.id = peer.id;
    this.host = peer.host;
    this.name = peer.name;
    this.email = peer.email;
  }

  dispose(): void {
      this.disposable.dispose();
  }
}

export interface RelativeSelection {
  start: Y.RelativePosition;
  end: Y.RelativePosition;
  direction: 'ltr' | 'rtl';
}

export interface AwarenessState {
  peer: string;
  currentSelection?: {
    path: string;
    selection: RelativeSelection;
  }
}

export const COLLABORATION_SELECTION = 'theia-collaboration-selection';
export const COLLABORATION_SELECTION_MARKER = 'theia-collaboration-selection-marker';
export const COLLABORATION_SELECTION_INVERTED = 'theia-collaboration-selection-inverted';

@injectable()
export class CollaborationInstance implements Disposable {

  @inject(MessageService)
  protected readonly messageService: MessageService;

  @inject(CollaborationWorkspaceService)
  protected readonly workspaceServie: CollaborationWorkspaceService;

  @inject(FileService)
  protected readonly fileService: FileService;

  @inject(MonacoTextModelService)
  protected readonly monacoModelService: MonacoTextModelService;

  @inject(EditorManager)
  protected readonly editorManager: EditorManager;

  @inject(OpenerService)
  protected readonly openerService: OpenerService;

  @inject(ApplicationShell)
  protected readonly shell: ApplicationShell;

  @inject(CollaborationInstanceOptions)
  protected readonly options: CollaborationInstanceOptions;

  @inject(CollaborationColorService)
  protected readonly collaborationColorService: CollaborationColorService;

  @inject(CollaborationUtils)
  protected readonly utils: CollaborationUtils;

  protected identity = new Deferred<types.Peer>();
  protected peers = new Map<string, CollaborationPeer>();
  protected ownSelections = new Map<EditorWidget, RelativeSelection>();
  protected yjs = new Y.Doc();
  protected yjsAwareness = new awarenessProtocol.Awareness(this.yjs);
  protected yjsProvider: OpenCollabYjsProvider;
  protected colorIndex = 0;
  protected editorDecorations = new Map<EditorWidget, string[]>();
  protected fileSystem?: CollaborationFileSystemProvider;
  protected permissions: types.Permissions = {
    readonly: false
  };

  protected onDidCloseEmitter = new Emitter<void>();


  get onDidClose(): Event<void> {
    return this.onDidCloseEmitter.event;
  }

  protected toDispose = new DisposableCollection();
  protected _readonly = false;

  get readonly(): boolean {
    return this._readonly;
  }

  set readonly(value: boolean) {
    if (value !== this.readonly) {
      if (this.options.role === 'guest' && this.fileSystem) {
        this.fileSystem.readonly = value;
      } else if (this.options.role === 'host') {
        this.options.connection.room.updatePermissions({
          ...(this.permissions ?? {}),
          readonly: value
        });
      }
      if (this.permissions) {
        this.permissions.readonly = value;
      }
      this._readonly = value;
    }
  }

  get isHost(): boolean {
    return this.options.role === 'host';
  }

  get host(): types.Peer {
    return Array.from(this.peers.values()).find(e => e.host)!;
  }

  @postConstruct()
  protected init(): void {
    const connection = this.options.connection;
    connection.onDisconnect(() => this.dispose());
    this.yjsProvider = new OpenCollabYjsProvider(connection, this.yjs, this.yjsAwareness);
    this.yjsProvider.connect();
    this.toDispose.push(Disposable.create(() => this.yjs.destroy()));
    this.toDispose.push(connection);
    this.toDispose.push(this.onDidCloseEmitter);

    this.registerProtocolEvents(connection);
    this.registerEditorEvents(connection);
    this.registerFileSystemEvents(connection);

    if (this.isHost) {
      this.registerFileSystemChanges();
    }
  }

  protected registerProtocolEvents(connection: types.ProtocolBroadcastConnection): void {
    connection.peer.onJoinRequest(async (_, user) => {
      const allow = nls.localizeByDefault('Allow');
      const deny = nls.localizeByDefault('Deny');
      const result = await this.messageService.info(
        nls.localize('theia/collaboration/userWantsToJoin', "User '{0}' wants to join the collaboration room", user.email ? `${user.name} (${user.email})` : user.name),
        allow,
        deny
      );
      return result === allow;
    });
    connection.room.onJoin((_, peer) => {
      this.addPeer(peer);
    });
    connection.room.onLeave((_, peer) => {
      this.peers.get(peer.id)?.dispose();
    });
    connection.room.onClose(() => {
      this.dispose();
    });
    connection.room.onPermissions((_, permissions) => {
      if (this.fileSystem) {
        this.fileSystem.readonly = permissions.readonly;
      }
    });
    connection.peer.onInfo((_, peer) => {
      this.yjsAwareness.setLocalStateField('peer', peer.id);
      this.identity.resolve(peer);
    });
    connection.peer.onInit(async () => {
      const roots = await this.workspaceServie.roots;
      const response: types.InitResponse = {
        protocol: '0.0.1',
        host: await this.identity.promise,
        guests: Array.from(this.peers.values()),
        capabilities: {},
        permissions: this.permissions,
        workspace: {
          name: this.workspaceServie.workspace?.name ?? nls.localize('theia/collaboration/collaboration', 'Collaboration'),
          folders: roots.map(e => e.name)
        }
      };
      return response;
    })
  }

  protected registerEditorEvents(connection: types.ProtocolBroadcastConnection): void {
    for (const model of this.monacoModelService.models) {
      if (this.isSharedResource(new URI(model.uri))) {
        this.registerModelUpdate(model);
      }
    }
    this.toDispose.push(this.monacoModelService.onDidCreate(newModel => {
      if (this.isSharedResource(new URI(newModel.uri))) {
        this.registerModelUpdate(newModel);
      }
    }));
    this.toDispose.push(this.editorManager.onCreated(widget => {
      if (this.isSharedResource(widget.getResourceUri())) {
        this.registerPresenceUpdate(widget);
      }
    }));
    this.getOpenEditors().forEach(widget => {
      if (this.isSharedResource(widget.getResourceUri())) {
        this.registerPresenceUpdate(widget);
      }
    });
    this.shell.onDidChangeActiveWidget(e => {
      if (e.newValue instanceof EditorWidget) {
        this.updateEditorPresence(e.newValue);
      }
    });

    this.yjsAwareness.on('change', () => {
      this.rerenderPresence();
    });

    this.yjs.on('beforeAllTransactions', () => {
      this.yjsMutex(() => {
        this.ownSelections.clear();
        for (const widget of this.getOpenEditors()) {
          const uri = widget.getResourceUri();
          if (uri) {
            const path = this.utils.getProtocolPath(uri);
            if (path) {
              const selection = widget.editor.selection;
              this.ownSelections.set(widget, this.createRelativeSelection(selection, widget.editor.document, this.yjs.getText(path)));
            }
          }
        }
      });
    });

    connection.editor.onOpen(async (_, path) => {
      const uri = this.utils.getResourceUri(path);
      if (uri) {
        await this.openUri(uri);
      } else {
        throw new Error('Could find file: ' + path);
      }
      return undefined;
    });
  }

  protected isSharedResource(resource?: URI): boolean {
    if (!resource) {
      return false;
    }
    return this.isHost ? resource.scheme === 'file' : resource.scheme === CollaborationURI.scheme;
  }

  protected registerFileSystemEvents(connection: types.ProtocolBroadcastConnection): void {
    connection.fs.onReadFile(async (_, path) => {
      const uri = this.utils.getResourceUri(path);
      if (uri) {
        const content = await this.fileService.readFile(uri);
        return content.value.toString();
      } else {
        throw new Error('Could find file: ' + path);
      }
    });
    connection.fs.onReaddir(async (_, path) => {
      const uri = this.utils.getResourceUri(path);
      if (uri) {
        const resolved = await this.fileService.resolve(uri);
        if (resolved.children) {
          const dir: Record<string, types.FileType> = {};
          for (const child of resolved.children) {
            dir[child.name] = child.isDirectory ? types.FileType.Directory : types.FileType.File;
          }
          return dir;
        } else {
          return {};
        }
      } else {
        throw new Error('Could find directory: ' + path);
      }
    });
    connection.fs.onStat(async (_, path) => {
      const uri = this.utils.getResourceUri(path);
      if (uri) {
        const content = await this.fileService.resolve(uri, {
          resolveMetadata: true
        });
        return {
          type: content.isDirectory ? types.FileType.Directory : types.FileType.File,
          ctime: content.ctime,
          mtime: content.mtime,
          size: content.size,
          permissions: content.isReadonly ? types.FilePermission.Readonly : undefined
        };
      } else {
        throw new Error('Could find file: ' + path);
      }
    });
    connection.fs.onWriteFile(async (_, path, content) => {
      const uri = this.utils.getResourceUri(path);
      if (uri) {
        await this.fileService.createFile(uri, BinaryBuffer.fromString(content));
      } else {
        throw new Error('Could find file: ' + path);
      }
    });
    connection.fs.onMkdir(async (_, path) => {
      const uri = this.utils.getResourceUri(path);
      if (uri) {
        await this.fileService.createFolder(uri);
      } else {
        throw new Error('Could find path: ' + path);
      }
    });
    connection.fs.onDelete(async (_, path) => {
      const uri = this.utils.getResourceUri(path);
      if (uri) {
        await this.fileService.delete(uri);
      } else {
        throw new Error('Could find entry: ' + path);
      }
    });
    connection.fs.onRename(async (_, from, to) => {
      const fromUri = this.utils.getResourceUri(from);
      const toUri = this.utils.getResourceUri(to);
      if (fromUri && toUri) {
        await this.fileService.move(fromUri, toUri);
      } else {
        throw new Error('Could find entries: ' + from + ' -> ' + to);
      }
    });
    connection.fs.onChange(async (_, event) => {
      // Only guests need ti handle file system changes
      if (!this.isHost && this.fileSystem) {
        const changes: FileChange[] = [];
        for (const change of event.changes) {
          const uri = this.utils.getResourceUri(change.path);
          if (uri) {
            changes.push({
              type: change.type === types.FileChangeEventType.Create
                  ? FileChangeType.ADDED
                  : change.type === types.FileChangeEventType.Update
                      ? FileChangeType.UPDATED
                      : FileChangeType.DELETED,
              resource: uri
            });
          }
        }
        this.fileSystem.triggerEvent(changes);
      }
    });
  }

  protected rerenderPresence(...widgets: EditorWidget[]): void {
    const decorations = new Map<string, EditorDecoration[]>();
    const states = this.yjsAwareness.getStates() as Map<number, AwarenessState>;
    for (const [clientID, state] of states.entries()) {
      if (clientID === this.yjs.clientID) {
        // Ignore own awareness state
        continue;
      }
      const peer = state.peer;
      if (!state.currentSelection || !this.peers.has(peer)) {
        continue;
      }
      const { path, selection } = state.currentSelection;
      const uri = this.utils.getResourceUri(path);
      if (uri) {
        const model = this.getModel(uri);
        if (model) {
          let existing = decorations.get(path);
          if (!existing) {
            existing = [];
            decorations.set(path, existing);
          }
          const forward = selection.direction === 'ltr';
          const startIndex = Y.createAbsolutePositionFromRelativePosition(selection.start, this.yjs);
          const endIndex = Y.createAbsolutePositionFromRelativePosition(selection.end, this.yjs);
          if (startIndex && endIndex) {
            const start = model.positionAt(startIndex.index);
            const end = model.positionAt(endIndex.index);
            const inverted = (forward && end.line === 0) || (!forward && start.line === 0);
            const range = {
              start,
              end
            };
            const contentClassNames: string[] = [COLLABORATION_SELECTION_MARKER, `${COLLABORATION_SELECTION_MARKER}-${peer}`];
            if (inverted) {
              contentClassNames.push(COLLABORATION_SELECTION_INVERTED);
            }
            const item: EditorDecoration = {
              range,
              options: {
                className: `${COLLABORATION_SELECTION} ${COLLABORATION_SELECTION}-${peer}`,
                beforeContentClassName: !forward ? contentClassNames.join(' ') : undefined,
                afterContentClassName: forward ? contentClassNames.join(' ') : undefined
              }
            };
            existing.push(item);
          } 
        }
      }
    }
    this.rerenderPresenceDecorations(decorations, ...widgets);
  }

  protected rerenderPresenceDecorations(decorations: Map<string, EditorDecoration[]>, ...widgets: EditorWidget[]): void {
    for (const editor of new Set(this.getOpenEditors().concat(widgets))) {
      const uri = editor.getResourceUri();
      const path = this.utils.getProtocolPath(uri);
      if (path) {
        const old = this.editorDecorations.get(editor) ?? [];
        this.editorDecorations.set(editor, editor.editor.deltaDecorations({
          newDecorations: decorations.get(path) ?? [],
          oldDecorations: old
        }));
      }
    }
  }

  protected registerFileSystemChanges(): void {
    // Event listener for disk based events
    this.fileService.onDidFilesChange(event => {
      const changes: types.FileChange[] = [];
      for (const change of event.changes) {
        const path = this.utils.getProtocolPath(change.resource);
        if (path) {
          let type: types.FileChangeEventType | undefined;
          if (change.type === FileChangeType.ADDED) {
            type = types.FileChangeEventType.Create;
          } else if (change.type === FileChangeType.DELETED) {
            type = types.FileChangeEventType.Delete;
          }
          // Updates to files on disk are not sent
          if (type !== undefined) {
            changes.push({
              path,
              type
            });
          }
        }
      }
      if (changes.length) {
        this.options.connection.fs.change({ changes });
      }
    });
    // Event listener for user based events
    this.fileService.onDidRunOperation(operation => {
      const path = this.utils.getProtocolPath(operation.resource);
      if (!path) {
        return;
      }
      let type = types.FileChangeEventType.Update;
      if (operation.isOperation(FileOperation.CREATE) || operation.isOperation(FileOperation.COPY)) {
        type = types.FileChangeEventType.Create;
      } else if (operation.isOperation(FileOperation.DELETE)) {
        type = types.FileChangeEventType.Delete;
      }
      this.options.connection.fs.change({
        changes: [{
          path,
          type
        }]
      });
    });
  }

  protected async registerPresenceUpdate(widget: EditorWidget): Promise<void> {
    const uri = widget.getResourceUri();
    const path = this.utils.getProtocolPath(uri);
    if (path) {
      if (!this.isHost) {
        this.options.connection.editor.open('', path);
      }
      let currentSelection = widget.editor.selection;
      const selectionChange = widget.editor.onSelectionChanged(selection => {
        if (!this.rangeEqual(currentSelection, selection)) {
          this.updateEditorPresence(widget);
          currentSelection = selection;
        }
      });
      const widgetDispose = widget.onDidDispose(() => {
        widgetDispose.dispose();
        selectionChange.dispose();
        // Remove presence information when the editor closes
        const state = this.yjsAwareness.getLocalState();
        if (state?.currentSelection?.path === path) {
          delete state.currentSelection;
        }
        this.yjsAwareness.setLocalState(state);
      });
      this.toDispose.push(selectionChange);
      this.toDispose.push(widgetDispose);
      this.rerenderPresence(widget);
    }
  }

  protected updateEditorPresence(widget: EditorWidget): void {
    const uri = widget.getResourceUri();
    const path = this.utils.getProtocolPath(uri);
    if (path) {
      const ytext = this.yjs.getText(path);
      const selection = widget.editor.selection;
      const start = widget.editor.document.offsetAt(selection.start);
      const end = widget.editor.document.offsetAt(selection.end);
      let direction: 'ltr' | 'rtl' = "ltr";
      const editorSelection = {
        // Force update the selection
        date: Date.now(),
        start: Y.createRelativePositionFromTypeIndex(ytext, start),
        end: Y.createRelativePositionFromTypeIndex(ytext, end),
        direction: direction
      };
      this.setSharedSelection(path, editorSelection);
    }
  }

  protected setSharedSelection(path: string, selection: RelativeSelection): void {
    this.yjsAwareness.setLocalStateField('currentSelection', {
      path,
      selection
    });
  }

  protected rangeEqual(a: Range, b: Range): boolean {
    return a.start.line === b.start.line
        && a.start.character === b.start.character
        && a.end.line === b.end.line
        && a.end.character === b.end.character;
  }

  async initialize(): Promise<void> {
    const response = await this.options.connection.peer.init('', {
      protocol: '0.0.1'
    });
    this.permissions = response.permissions;
    this.readonly = response.permissions.readonly;
    for (const peer of [...response.guests, response.host]) {
      this.addPeer(peer);
    }
    this.fileSystem = new CollaborationFileSystemProvider(this.options.connection, this.yjs);
    this.fileSystem.readonly = this.readonly;
    this.toDispose.push(this.fileService.registerProvider(CollaborationURI.scheme, this.fileSystem));
    const workspaceDisposable = await this.workspaceServie.setHostWorkspace(response.workspace, this.options.connection);
    this.toDispose.push(workspaceDisposable);
  }

  protected addPeer(peer: types.Peer): void {
    const collection = new DisposableCollection();
    collection.push(this.createPeerStyleSheet(peer));
    collection.push(Disposable.create(() => this.peers.delete(peer.id)));
    const disposablePeer = new CollaborationPeer(peer, collection);
    this.peers.set(peer.id, disposablePeer);
  }

  protected createPeerStyleSheet(peer: types.Peer): Disposable {
    const style = DecorationStyle.createStyleElement(peer.id);
    const colors = this.collaborationColorService.getColors();
    const sheet = style.sheet!;
    const color = colors[this.colorIndex++ % colors.length];
    const colorString = `rgb(${color.r}, ${color.g}, ${color.b})`;
    sheet.insertRule(`
      .${COLLABORATION_SELECTION}-${peer.id} {
        opacity: 0.2;
        background: ${colorString};
      }
    `);
    sheet.insertRule(`
      .${COLLABORATION_SELECTION_MARKER}-${peer.id} {
        background: ${colorString};
        border-color: ${colorString};
      }
    `);
    sheet.insertRule(`
      .${COLLABORATION_SELECTION_MARKER}-${peer.id}::after {
        content: "${peer.name}";
        background: ${colorString};
        color: ${this.collaborationColorService.requiresDarkFont(color)
      ? this.collaborationColorService.dark
      : this.collaborationColorService.light};
        z-index: ${(100 + this.colorIndex).toFixed()}
      }
    `);
    return Disposable.create(() => style.remove());
  }

  protected getOpenEditors(uri?: URI): EditorWidget[] {
    const widgets = this.shell.widgets;
    let editors = widgets.filter(e => e instanceof EditorWidget) as EditorWidget[];
    if (uri) {
      const uriString = uri.toString();
      editors = editors.filter(e => e.getResourceUri()?.toString() === uriString);
    }
    return editors;
  }

  protected createSelectionFromRelative(selection: RelativeSelection, model: MonacoEditorModel): Selection | undefined {
    const start = Y.createAbsolutePositionFromRelativePosition(selection.start, this.yjs);
    const end = Y.createAbsolutePositionFromRelativePosition(selection.end, this.yjs);
    if (start && end) {
      return {
        start: model.positionAt(start.index),
        end: model.positionAt(end.index),
        direction: selection.direction
      };
    }
    return undefined;
  }

  protected createRelativeSelection(selection: Range, model: TextEditorDocument, ytext: Y.Text): RelativeSelection {
    const start = Y.createRelativePositionFromTypeIndex(ytext, model.offsetAt(selection.start));
    const end = Y.createRelativePositionFromTypeIndex(ytext, model.offsetAt(selection.end));
    return {
      start,
      end,
      direction: 'ltr'
    };
  }

  protected readonly yjsMutex = createMutex();

  protected registerModelUpdate(model: MonacoEditorModel): void {
    let updating = false;
    const modelPath = this.utils.getProtocolPath(new URI(model.uri))!;
    const unknownModel = !this.yjs.share.has(modelPath);
    const ytext = this.yjs.getText(modelPath);
    const modelText = model.textEditorModel.getValue();
    if (this.isHost && unknownModel) {
      this.yjs.transact(() => {
        // If we are hosting the room, set the initial content
        // First off, reset the shared content to be empty
        // This has the benefit of effectively clearing the memory of the shared content across all peers
        // This is important because the shared content accumulates changes/memory usage over time
        ytext.delete(0, ytext.length);
        // Then, insert the content of text model
        ytext.insert(0, modelText);
      });
    }
    // Always update the model content to match the shared content
    const ytextContent = ytext.toString();
    if (modelText !== ytextContent) {
      model.textEditorModel.setValue(ytextContent);
    }
    // The Ytext instance is our source of truth for the model content
    // Sometimes (especially after a lot of sequential undo/redo operations) our model content can get out of sync
    // This resyncs the model content with the Ytext content after a delay
    const resyncThrottle = throttle(() => {
      this.yjsMutex(() => {
        const newContent = ytext.toString();
        if (model.textEditorModel.getValue() !== newContent) {
          updating = true;
          this.softReplaceModel(model, newContent);
          updating = false;
        }
      });
    }, 500);
    const disposable = new DisposableCollection();
    disposable.push(model.onDidChangeContent(e => {
      if (updating) {
        return;
      }
      this.yjsMutex(() => {
        this.yjs.transact(() => {
          for (const change of e.contentChanges) {
            if ('range' in change) {
              ytext.delete(change.range.start.character, change.range.end.character);
               ytext.insert(change.range.end.character, change.text);
            } else {
              // handler error
              throw new Error("No range in change");
            }
          }
        });
        resyncThrottle();
      });
    }));

    const observer = (textEvent: Y.YTextEvent) => {
      this.yjsMutex(() => {
        updating = true;
        try {
          let index = 0;
          const operations: { range: MonacoRange, text: string }[] = [];
          textEvent.delta.forEach(delta => {
            if (delta.retain !== undefined) {
              index += delta.retain;
            } else if (delta.insert !== undefined) {
              const pos = model.textEditorModel.getPositionAt(index);
              const range = new MonacoRange(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
              const insert = delta.insert as string;
              operations.push({ range, text: insert});
              index += insert.length;
            } else if (delta.delete !== undefined) {
              const pos = model.textEditorModel.getPositionAt(index);
              const endPos = model.textEditorModel.getPositionAt(index + delta.delete);
              const range = new MonacoRange(pos.lineNumber, pos.column, endPos.lineNumber, endPos.column);
              operations.push({ range, text: ''});
            }
          });
          this.pushChangesToModel(model, operations);
        } catch (err) {
          console.error(err);
        }
        this.ownSelections.forEach((selection, widget) => {
          const uri = widget.getResourceUri();
          if (uri) {
            const path = this.utils.getProtocolPath(uri);
            if (path === modelPath) {
              const relativeSelection = this.createSelectionFromRelative(selection, model);
              if (relativeSelection) {
                widget.editor.selection = relativeSelection;
              }
            }
          }
        });
        resyncThrottle();
        updating = false;
      });
    };

    ytext.observe(observer);
    disposable.push(Disposable.create(() => ytext.unobserve(observer)));
    model.onDispose(() => disposable.dispose());
  }

  protected getModel(uri: URI): MonacoEditorModel | undefined {
    const existing = this.monacoModelService.models.find(e => e.uri === uri.toString());
    if (existing) {
      return existing;
    } else {
      return undefined;
    }
  }

  protected pushChangesToModel(model: MonacoEditorModel, changes: { range: MonacoRange, text: string, forceMoveMarkers?: boolean }[]): void {
    const editor = MonacoEditor.findByDocument(this.editorManager, model)[0];
    const cursorState = editor?.getControl().getSelections() ?? [];
    model.textEditorModel.pushStackElement();
    model.textEditorModel.pushEditOperations(cursorState, changes, () => cursorState);
    model.textEditorModel.pushStackElement();
  }

  protected softReplaceModel(model: MonacoEditorModel, text: string): void {
    this.pushChangesToModel(model, [{
      range: model.textEditorModel.getFullModelRange(),
      text,
      forceMoveMarkers: false
    }]);
  }

  protected async openUri(uri: URI): Promise<void> {
    const opener = await this.openerService.getOpener(uri);
    await opener.open(uri, {
      mode: 'none'
    });
  }

  dispose(): void {
    for (const peer of this.peers.values()) {
      peer.dispose();
    }
    this.onDidCloseEmitter.fire();
    this.toDispose.dispose();
  }
}
