import { SpartanPreset } from '../enums/spartan-preset.enum';
import { ThemeFont } from '../enums/theme-font.enum';
import { Palette, PALETTE_KEYS, Theme } from '../types/theme';
import { buildThemeCss } from './theme-css.util';

function buildPalette(overrides: Partial<Palette> = {}): Palette {
  const base = Object.fromEntries(
    PALETTE_KEYS.map((key, index) => [key, `oklch(0.5 0.1 ${index})`]),
  ) as Palette;
  return { ...base, ...overrides };
}

function buildTheme(overrides: Partial<Theme> = {}): Theme {
  return {
    name: 'Verdant Calm',
    description: 'Natural teal and sage palette.',
    style: SpartanPreset.Maia,
    font: ThemeFont.Sans,
    radius: '1rem',
    light: buildPalette({ background: 'oklch(0.975 0.012 160)' }),
    dark: buildPalette({ background: 'oklch(0.13 0.04 165)' }),
    ...overrides,
  };
}

describe('buildThemeCss', () => {
  it('carries the preset, name and description through unchanged', () => {
    const inputTheme = buildTheme();

    const actual = buildThemeCss(inputTheme);

    expect(actual.basePreset).toBe(SpartanPreset.Maia);
    expect(actual.name).toBe('Verdant Calm');
    expect(actual.description).toBe('Natural teal and sage palette.');
  });

  it('emits the light palette in :root and the dark palette in .dark', () => {
    const inputTheme = buildTheme();

    const [rootBlock, darkBlock] = buildThemeCss(inputTheme).rawCss.split('\n');

    expect(rootBlock).toContain('--background: oklch(0.975 0.012 160);');
    expect(darkBlock).toContain('--background: oklch(0.13 0.04 165);');
    expect(darkBlock.startsWith('.dark {')).toBe(true);
  });

  it('keeps --radius and the font tokens out of the dark block', () => {
    const inputTheme = buildTheme({ radius: '0.5rem', font: ThemeFont.Serif });

    const [rootBlock, darkBlock] = buildThemeCss(inputTheme).rawCss.split('\n');

    expect(rootBlock).toContain('--radius: 0.5rem;');
    expect(rootBlock).toContain('--font-body: var(--font-serif);');
    expect(rootBlock).toContain('--font-mono:');
    expect(darkBlock).not.toContain('--radius');
    expect(darkBlock).not.toContain('--font-');
  });

  it('converts camelCase and numbered keys to kebab-case tokens', () => {
    const inputTheme = buildTheme({
      light: buildPalette({
        cardForeground: 'oklch(0.15 0.04 165)',
        chart1: 'oklch(0.6 0.12 20)',
      }),
    });

    const actualCss = buildThemeCss(inputTheme).rawCss;

    expect(actualCss).toContain('--card-foreground: oklch(0.15 0.04 165);');
    expect(actualCss).toContain('--chart-1: oklch(0.6 0.12 20);');
  });

  it('derives the sidebar tokens from the palette in both schemes', () => {
    const inputTheme = buildTheme({
      light: buildPalette({
        card: 'oklch(1 0 0)',
        primary: 'oklch(0.48 0.13 165)',
      }),
    });

    const [rootBlock, darkBlock] = buildThemeCss(inputTheme).rawCss.split('\n');

    expect(rootBlock).toContain('--sidebar: oklch(1 0 0);');
    expect(rootBlock).toContain('--sidebar-primary: oklch(0.48 0.13 165);');
    expect(darkBlock).toContain('--sidebar-ring:');
  });
});
