import '../../src/browser/style/index.css'

import { Command, CommandContribution, CommandRegistry, MessageService, nls, Progress, QuickInputService, QuickPickItem } from "@theia/core";
import { inject, injectable, optional, postConstruct } from "@theia/core/shared/inversify";
import { ConnectionProvider } from "open-collaboration-protocol";
