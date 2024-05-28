import { injectable } from "@theia/core/shared/inversify";

export interface CollaborationColor {
  r: number;
  g: number;
  b: number;
}

export namespace CollaborationColor {
  export function fromString(code: string): CollaborationColor {
    if (code. startsWith('#')) {
      code = code.substring(1);
    }
    const r = parseInt(code.substring(0, 2), 16);
    const g = parseInt(code.substring(2, 4), 16);
    const b = parseInt(code.substring(4, 6), 16);
    return {r, g, b};
  }

  export const Gold = fromString('#FFD700');
  export const Tomato = fromString('#FF6347');
  export const Aquamarine = fromString('#7FFFD4');
  export const Beige = fromString('#F5F5DC');
  export const Coral = fromString('#FF7F50');
  export const DarkOrange = fromString('#FF8C00');
  export const VioletRed = fromString('#C71585');
  export const DodgerBlue = fromString('#1E90FF');
  export const Chocolate = fromString('#D2691E');
  export const LightGreen = fromString('#90EE90');
  export const MediumOrchid = fromString('#BA55D3');
  export const Orange = fromString('#FFA500');
}

@injectable()
export class CollaborationColorService {

  light = 'white';
  dark = 'black';

  getColors(): CollaborationColor[] {
    return [
      CollaborationColor.Gold,
      CollaborationColor.Aquamarine,
      CollaborationColor.Tomato,
      CollaborationColor.MediumOrchid,
      CollaborationColor.LightGreen,
      CollaborationColor.Orange,
      CollaborationColor.Beige,
      CollaborationColor.Chocolate,
      CollaborationColor.VioletRed,
      CollaborationColor.Coral,
      CollaborationColor.DodgerBlue,
      CollaborationColor.DarkOrange
    ];
  }

  requiresDarkFont(color: CollaborationColor): boolean {
    return ((color.r * 0.299) + (color.g * 0.587) + (color.b * 0.114)) > 186;
  }
}