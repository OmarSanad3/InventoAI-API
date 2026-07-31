import { SpartanPreset } from '../enums/spartan-preset.enum';
import { ThemeFont } from '../enums/theme-font.enum';

/**
 * Every colour token the AI must produce, in the order they are emitted as CSS
 * variables. Single source of truth: the palette DTO, the Gemini response schema
 * and `buildThemeCss` are all derived from this list.
 */
export const PALETTE_KEYS = [
  'background',
  'foreground',
  'card',
  'cardForeground',
  'popover',
  'popoverForeground',
  'primary',
  'primaryForeground',
  'secondary',
  'secondaryForeground',
  'muted',
  'mutedForeground',
  'accent',
  'accentForeground',
  'destructive',
  'border',
  'input',
  'ring',
  'chart1',
  'chart2',
  'chart3',
  'chart4',
  'chart5',
] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];

export type Palette = Record<PaletteKey, string>;

export interface Theme {
  readonly name: string;
  readonly description: string;
  readonly style: SpartanPreset;
  readonly font: ThemeFont;
  readonly radius: string;
  readonly light: Palette;
  readonly dark: Palette;
}
