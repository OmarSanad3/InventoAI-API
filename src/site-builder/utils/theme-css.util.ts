import { ThemeCssDto } from '../dto/theme-css.dto';
import { ThemeFont } from '../enums/theme-font.enum';
import { FONT_STACKS } from '../site-builder.constants';
import { Palette, PALETTE_KEYS, PaletteKey, Theme } from '../types/theme';

/**
 * Admin chrome the storefront never uses, so the AI is not asked for it — the
 * tokens are derived from the palette it did produce.
 */
const SIDEBAR_TOKENS: ReadonlyArray<readonly [string, PaletteKey]> = [
  ['sidebar', 'card'],
  ['sidebar-foreground', 'foreground'],
  ['sidebar-primary', 'primary'],
  ['sidebar-primary-foreground', 'primaryForeground'],
  ['sidebar-accent', 'accent'],
  ['sidebar-accent-foreground', 'accentForeground'],
  ['sidebar-border', 'border'],
  ['sidebar-ring', 'ring'],
];

/**
 * Converts a stored theme into the `basePreset` / `rawCss` shape the frontend
 * consumes. Pure: same theme in, same CSS out.
 */
export function buildThemeCss(theme: Theme): ThemeCssDto {
  const dto = new ThemeCssDto();
  dto.basePreset = theme.style;
  dto.name = theme.name;
  dto.description = theme.description;
  dto.rawCss = [
    `:root { ${buildRootDeclarations(theme).join(' ')} }`,
    `.dark { ${buildPaletteDeclarations(theme.dark).join(' ')} }`,
  ].join('\n');
  return dto;
}

/** `--radius` and the fonts live in `:root` only — neither is scheme-dependent. */
function buildRootDeclarations(theme: Theme): string[] {
  return [
    declaration('radius', theme.radius),
    ...buildFontDeclarations(theme.font),
    ...buildPaletteDeclarations(theme.light),
  ];
}

function buildFontDeclarations(font: ThemeFont): string[] {
  return [
    ...Object.values(ThemeFont).map((name) =>
      declaration(`font-${name}`, FONT_STACKS[name]),
    ),
    declaration('font-body', `var(--font-${font})`),
  ];
}

function buildPaletteDeclarations(palette: Palette): string[] {
  return [
    ...PALETTE_KEYS.map((key) => declaration(toTokenName(key), palette[key])),
    ...SIDEBAR_TOKENS.map(([token, source]) =>
      declaration(token, palette[source]),
    ),
  ];
}

function declaration(token: string, value: string): string {
  return `--${token}: ${value};`;
}

/** `cardForeground` -> `card-foreground`, `chart1` -> `chart-1`. */
function toTokenName(key: PaletteKey): string {
  return key.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
}
