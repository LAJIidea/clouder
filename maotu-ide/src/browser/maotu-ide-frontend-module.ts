import { CommandContribution, MenuContribution } from "@theia/core";
import { ContainerModule } from '@theia/core/shared/inversify';
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { MaotuIdeWidget } from './maotu-ide-widget';
import { MaotuIdeContribution } from './maotu-ide-contribution';
import { bindViewContribution, FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { CollaborationColorService } from "./collaboration-color-service";
import { CollaborationFrontendContribution } from "./collaboration-frontend-contribution";
import { CollaborationInstance, CollaborationInstanceFactory, CollaborationInstanceOptions, createCollaborationInstanceContainer } from "./collaboration-instance";
import { CollaborationUtils } from "./collaboration-utils";
import { CollaborationWorkspaceService } from "./collaboration-workspace-service";

import '../../src/browser/style/index.css';

export default new ContainerModule((bind, _, __, rebind) => {
    bindViewContribution(bind, MaotuIdeContribution);
    bind(FrontendApplicationContribution).toService(MaotuIdeContribution);
    bind(MaotuIdeWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: MaotuIdeWidget.ID,
        createWidget: () => ctx.container.get<MaotuIdeWidget>(MaotuIdeWidget)
    })).inSingletonScope();
    bind(CollaborationWorkspaceService).toSelf().inSingletonScope();
    rebind(WorkspaceService).toService(CollaborationWorkspaceService);
    bind(CollaborationUtils).toSelf().inSingletonScope();
    bind(CollaborationFrontendContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(CollaborationFrontendContribution);
    bind(MenuContribution).toService(CollaborationFrontendContribution);
    bind(CollaborationInstanceFactory).toFactory(context => (options: CollaborationInstanceOptions) => {
        const container = createCollaborationInstanceContainer(context.container, options);
        return container.get(CollaborationInstance);
    });
    bind(CollaborationColorService).toSelf().inSingletonScope();
});