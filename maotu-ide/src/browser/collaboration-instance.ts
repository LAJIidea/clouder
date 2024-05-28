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
import { EditorDecoration, EditorWidget, TextEditorDocument, TextEditorSelection } from "@theia/editor/lib/browser";
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
  protected ownSelections = new Map<EditorManager, RelativeSelection>();
  protected yjs = new Y.Doc();
  protected yjsAwareness = new awarenessProtocol.Awareness(this.yjs);
  protected yjsProvider: OpenCollabYjsProvider;
  protected colorIndex = 0;
  protected editorDecoration = new Map<EditorWidget, string[]>();
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

  }

  protected registerEditorEvents(connection: types.ProtocolBroadcastConnection): void {

  }

  protected isSharedResource(resource?: URI): boolean {
    if (!resource) {
      return false;
    }
    return this.isHost ? resource.scheme === 'file' : resource.scheme === CollaborationURI.scheme;
  }

  protected registerFileSystemEvents(connection: types.ProtocolBroadcastConnection): void {

  }

  protected rerenderPresence(...widgets: EditorWidget[]): void {

  }

  protected rerenderPresenceDecorations(decorations: Map<string, EditorDecoration[]>, ...widgets: EditorWidget[]): void {

  }

  protected registerFileSystemChanges(): void {

  }

  protected registerModelUpdate(model: MonacoEditorModel): void {

  }

  dispose(): void {
    for (const peer of this.peers.values()) {
      peer.dispose();
    }
    this.onDidCloseEmitter.fire();
    this.toDispose.dispose();
  }
}
