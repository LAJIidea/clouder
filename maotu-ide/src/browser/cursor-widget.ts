//@ts-ignore
import { Awareness } from "y-protocols/awareness";

import { injectable } from "@theia/core/shared/inversify";
import { IDisposable } from "@theia/monaco-editor-core/esm/vs/base/common/lifecycle";
import { 
  ICodeEditor, 
  IContentWidget,
  IContentWidgetPosition,
  ContentWidgetPositionPreference
} from '@theia/monaco-editor-core/esm/vs/editor/browser/editorBrowser';

import { ICursorWidegtRegistry, UserInfo, Y_REMOTE_SELECTION } from "../common";

const createPositionFrom = (lineNumber: number, column: number): IContentWidgetPosition => ({
  position: {lineNumber, column},
  preference: [
    ContentWidgetPositionPreference.ABOVE,
    ContentWidgetPositionPreference.BELOW,
  ],
});

@injectable()
export class CursorWidget implements IContentWidget {
  private domNode: HTMLElement;

  private id: string;

  position: IContentWidgetPosition | null = null;

  constructor(nickname: string, clientID: number) {
    // init dom node
    this.domNode = document.createElement('div');
    this.domNode.innerHTML = nickname;
    this.domNode.style.opacity = '1';
    this.domNode.style.whiteSpace = 'nowrap';
    this.domNode.className = `${Y_REMOTE_SELECTION}-${clientID}`;
    // set id
    this.id = `cursor-widget-${nickname}`;
  }

  getId(): string {
      return this.id;
  }

  getDomNode(): HTMLElement {
      return this.domNode;
  }

  getPosition(): IContentWidgetPosition | null {
      return this.position;
  }

}

@injectable()
export class CursorWidgetRegistry implements ICursorWidegtRegistry {

  // store all widgets here, and widgets will be automatically added or removed from this registry. clientID => widget
  widgets: Map<number, CursorWidget> = new Map();

  // target editor
  editor: ICodeEditor;

  awareness: Awareness;

  disposable: IDisposable;

  constructor(editor: ICodeEditor, awareness: Awareness) {
    this.editor = editor;
    this.awareness = awareness;
    this.disposable = editor.onDidDispose(() => this.destroy());
    awareness.on('update', this.onAwarenessStateChange);

    this.getWidgetFromRegistry();
  }

  private getWidgetFromRegistry(): void {
    // create widget from awareness
    this.awareness.getStates().forEach((state, clientId) => {
      const info: UserInfo = state['user-info'];
      if (info) {
        this.createWidget(clientId, info.nickname);
      }
    });
  }

  updatePositionOf(clientID: number, lineNumber: number, column: number): void {
    const widget = this.widgets.get(clientID);
    if (widget) {
      widget.position = createPositionFrom(lineNumber, column);
    }
  }

  removeAllPositions(editor: ICodeEditor): void {
    this.widgets.forEach((widget) => {
      widget.position = null;
    });
  }

  layoutAllWidgets(): void {
    this.widgets.forEach((widget) => {
      this.editor.layoutContentWidget(widget);
    });
  }

  destroy(): void {
    // remove all from editor
    this.widgets.forEach((widget) => {
      this.editor.removeContentWidget(widget);
    });
    this.awareness.off('update', this.onAwarenessStateChange);
    if (this.disposable) {
      this.disposable.dispose();
    }
  }

  private createWidget(clientID: number, nickname: string): void {
    if (!this.widgets.has(clientID)) {
      const widget = new CursorWidget(nickname, clientID);
      this.editor.addContentWidget(widget);
      this.widgets.set(clientID, widget);
    }
  }

  // private deleteWidget(clientID: number): void {
  //   const widget = this.widgets.get(clientID);
  //   if (widget) {
  //     this.editor.removeContentWidget(widget);
  //     this.widgets.delete(clientID);
  //   }
  // }

  private onAwarenessStateChange = (changes: { added: number[]; updated: number[]; removed: number[] }) => {
    if (changes.added.length > 0) {
      this.getWidgetFromRegistry();
    }
  }
}

