import { URI } from "@theia/core";
import { inject, injectable } from "@theia/core/shared/inversify";
import { CollaborationWorkspaceService } from "./collaboration-workspace-service";

@injectable()
export class CollaborationUtils {

  @inject(CollaborationWorkspaceService)
  protected readonly workspaceService: CollaborationWorkspaceService;

  getProtocolPath(uri?: URI): string | undefined {
    if (!uri) {
      return undefined;
    }
    const path = uri.path.toString();
    const roots = this.workspaceService.tryGetRoots();
    for (const root of roots) {
      const rootUri = root.resource.path.toString() + '/';
      if (path.startsWith(rootUri)) {
        return root.name + '/' + path.substring(rootUri.length);
      }
    }
    return undefined;
  }

  getResourceUri(path?: string): URI | undefined {
    if (!path) {
      return undefined;
    }
    const parts = path.split('/');
    const root = parts[0];
    const rest = parts.slice(1);
    const stat = this.workspaceService.tryGetRoots().find(e => e.name === root);
    if (stat) {
      const uriPath = stat.resource.path.join(...rest);
      const uri = stat.resource.withPath(uriPath);
      return uri;
    } else {
      return undefined;
    }
  }
}