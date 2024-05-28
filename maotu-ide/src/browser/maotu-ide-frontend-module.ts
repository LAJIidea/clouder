import { ContainerModule } from '@theia/core/shared/inversify';
import { MaotuIdeWidget } from './maotu-ide-widget';
import { MaotuIdeContribution } from './maotu-ide-contribution';
import { bindViewContribution, FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';

import '../../src/browser/style/index.css';

let container = new ContainerModule(bind => {
    bindViewContribution(bind, MaotuIdeContribution);
    bind(FrontendApplicationContribution).toService(MaotuIdeContribution);
    bind(MaotuIdeWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: MaotuIdeWidget.ID,
        createWidget: () => ctx.container.get<MaotuIdeWidget>(MaotuIdeWidget)
    })).inSingletonScope();
});

export default container;