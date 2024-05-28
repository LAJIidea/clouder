import { nls } from "@theia/core";
import { injectable } from "@theia/core/shared/inversify";
import { Disposable } from "@theia/core";
import { FileStat } from "@theia/filesystem/lib/common/files";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { Workspace, ProtocolBroadcastConnection } from "open-collaboration-protocol";
import { CollaborationURI } from "./collaboration-file-system-provider";

@injectable()
export class CollaborationWorkspaceService extends WorkspaceService {

  protected collabWorkspace?: Workspace;
  protected connection?: ProtocolBroadcastConnection;

  async setHostWorkspace(workspace: Workspace, connection: ProtocolBroadcastConnection): Promise<Disposable> {
    this.collabWorkspace = workspace;
    this.connection = connection;
    await this.setWorkspace({
      isDirectory: false,
      isFile: true,
      isReadonly: false,
      isSymbolicLink: false,
      name: nls.localize('theia/collaboration/collaborationWorkspace', 'Collaboration Workspace'),
      resource: CollaborationURI.create(this.collabWorkspace)
    });
    return Disposable.create(() => {
      this.collabWorkspace = undefined;
      this.connection = undefined;
      this.setWorkspace(undefined);
    });
  }

  protected override computeRoots(): Promise<FileStat[]> {
    if (this.collabWorkspace) {
      return new Promise((resolve, reject) => {
        resolve(this.collabWorkspace!.folders.map(e => this.entryToStat(e)))
      });
    } else {
      return super.computeRoots();
    }
  }

  protected entryToStat(entry: string): FileStat {
    const uri = CollaborationURI.create(this.collabWorkspace!, entry);
    return {
      resource: uri,
      name: entry,
      isDirectory: true,
      isFile: false,
      isReadonly: false,
      isSymbolicLink: false
    };
  }
}