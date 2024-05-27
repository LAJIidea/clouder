import { Command } from "@theia/core/lib/common/command";

const COMMAND_CATEGORY = 'Collaboration';

export const UNDO: Command = {
  id: 'collaboration.undo',
  label: 'collaboration.undo',
  category: COMMAND_CATEGORY,
};

export const REDO: Command = {
  id: 'collaboration.redo',
  label: 'collaboration.redo',
  category: COMMAND_CATEGORY,
}