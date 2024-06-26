import * as Y from "yjs";
import { Disposable, Emitter, Event, URI } from "@theia/core";
import { injectable } from "@theia/core/shared/inversify";
import { 
  FileChange, FileDeleteOptions, FileOverwriteOptions, FileSystemProviderCapabilities,
  FileType, Stat, FileSystemProviderWithFileReadWriteCapability, FileWriteOptions,
  WatchOptions
} from "@theia/filesystem/lib/common/files";
import { ProtocolBroadcastConnection, Workspace } from "open-collaboration-protocol";

export namespace CollaborationURI {

  export const scheme = 'collaboration';

  export function create(workspace: Workspace, path?: string): URI {
    return new URI(`${scheme}:///${workspace.name}${path ? '/' + path : ''}`);
  }
}

@injectable()
export class CollaborationFileSystemProvider implements FileSystemProviderWithFileReadWriteCapability {
  capabilities: FileSystemProviderCapabilities.FileReadWrite;

  protected _readonly: boolean;

  get readonly(): boolean {
    return this._readonly;
  }

  set readonly(value: boolean) {
    if (this._readonly !== value) {
      this._readonly = value;
      if (value) {
        this.capabilities |= FileSystemProviderCapabilities.Readonly;
      } else {
        this.capabilities &= ~FileSystemProviderCapabilities.Readonly;
      }
      this.onDidChangeCapabilitiesEmitter.fire();
    }
  }

  constructor(readonly connection: ProtocolBroadcastConnection, readonly yjs: Y.Doc) {
  }

  protected encoder = new TextEncoder();
  protected decoder = new TextDecoder();
  protected onDidChangeCapabilitiesEmitter = new Emitter<void>();
  protected onDidChangeFileEmitter = new Emitter<readonly FileChange[]>();
  protected onFileWatchErrorEmitter = new Emitter<void>();

  get onDidChangeCapabilities(): Event<void> {
    return this.onDidChangeCapabilitiesEmitter.event;
  }
  get onDidChangeFile(): Event<readonly FileChange[]> {
    return this.onDidChangeFileEmitter.event;
  }
  get onFileWatchError(): Event<void> {
    return this.onFileWatchErrorEmitter.event;
  }
  async readFile(resource: URI): Promise<Uint8Array> {
      const path = this.getHostPath(resource);
      if (this.yjs.share.has(path)) {
        const stringValue = this.yjs.getText(path);
        return this.encoder.encode(stringValue.toString());
      } else {
        // Attempt to stat the file to see if it exists on the host system
        await this.stat(resource);
        // Return an empty if the file exists
        // The respective yjs content will be created when the host opens the file
        return new Uint8Array();
      }
  }

  async writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> {

  }
  watch(resource: URI, opts: WatchOptions): Disposable {
      return Disposable.NULL;
  }
  stat(resource: URI): Promise<Stat> {
    return this.connection.fs.stat('', this.getHostPath(resource));
  }
  mkdir(resource: URI): Promise<void> {
      return this.connection.fs.mkdir('', this.getHostPath(resource));
  }
  async readdir(resource: URI): Promise<[string, FileType][]> {
      const record = await this.connection.fs.readdir('', this.getHostPath(resource));
      return Object.entries(record);
  }
  delete(resource: URI, opts: FileDeleteOptions): Promise<void> {
      return this.connection.fs.delete('', this.getHostPath(resource));
  }
  rename(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> {
      return this.connection.fs.rename('', this.getHostPath(from), this.getHostPath(to));
  }

  protected getHostPath(uri: URI): string {
    const path = uri.path.toString().substring(1).split('/');
    return path.slice(1).join('/');
  }

  triggerEvent(changes: FileChange[]): void {
    this.onDidChangeFileEmitter.fire(changes);
  }
}