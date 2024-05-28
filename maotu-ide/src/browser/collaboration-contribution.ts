import { injectable, inject, named } from "@theia/core/shared/inversify";
import { CommandContribution, ContributionProvider, MaybePromise } from "@theia/core";
import { 
  FrontendApplication,
  FrontendApplicationContribution, 
  KeybindingContribution, 
  KeybindingRegistry 
} from "@theia/core/lib/browser";
import { CommandRegistry } from "@theia/core/lib/common/command";

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
    this.collaborationService.initFileWatch();
  }

  onStart(app: FrontendApplication): MaybePromise<void> {
    const providers = this.contributionProvider.getContributions();
    for (const provider of providers) {
      this.collaborationService.registerContribution(provider);
    }
    this.collaborationService.registerUserInfo();
  }

  onStop(app: FrontendApplication): void {
    this.collaborationService.destroy(); 
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    keybindings.registerKeybinding({
      command: UNDO.id,
      keybinding: 'ctrlcmd+z',
      when: 'editorFocus',
    });

    keybindings.registerKeybinding({
      command: REDO.id,
      keybinding: 'shift+ctrlcmd+z',
      when: 'editorFocus',
    })
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(UNDO, {
      execute: () => {
        this.collaborationService.undoOnFocusedTextModel();
      }
    });
    
    commands.registerCommand(REDO, {
      execute: () => {
        this.collaborationService.redoOnFocusedTextModel();
      },
    });
  }
}