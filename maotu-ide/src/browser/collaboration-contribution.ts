import { injectable, inject, named } from "@theia/core/shared/inversify";
import { CommandContribution, ContributionProvider, MaybePromise, MenuContribution } from "@theia/core";
import { 
  FrontendApplication,
  FrontendApplicationContribution, 
  KeybindingContribution, 
  KeybindingRegistry 
} from "@theia/core/lib/browser";
import { CommandRegistry } from "@theia/core/lib/common/command";
import { CollaborationFileSystemProvider } from "./collaboration-file-system-provider";

import { CollaborationModuleContribution, ICollaborationService } from "../common";
import { REDO, UNDO } from "../common/commands";

@injectable()
export class CollaborationContribution implements FrontendApplicationContribution, CommandContribution, KeybindingContribution {

  @inject(ICollaborationService)
  private collaborationService: ICollaborationService;

  @inject(ContributionProvider) @named(CollaborationModuleContribution)
  private readonly contributionProvider: ContributionProvider<CollaborationModuleContribution>;

  initialize(): void {
    this.collaborationService.initialize();
  }

  onStart(app: FrontendApplication): MaybePromise<void> {
      
  }

  onStop(app: FrontendApplication): void {
      
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
      
  }

  registerCommands(commands: CommandRegistry): void {
      
  }

}