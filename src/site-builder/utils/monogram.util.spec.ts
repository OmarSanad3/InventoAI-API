import { ThemeFont } from '../enums/theme-font.enum';
import { buildMonogramSvg, MonogramOptions } from './monogram.util';

function buildOptions(
  overrides: Partial<MonogramOptions> = {},
): MonogramOptions {
  return {
    businessName: 'Sanad Toys',
    background: 'oklch(0 0 0)',
    foreground: 'oklch(1 0 0)',
    font: ThemeFont.Sans,
    radius: '1rem',
    ...overrides,
  };
}

describe('buildMonogramSvg', () => {
  it('uses the initial of each of the first two words', () => {
    const actual = buildMonogramSvg(buildOptions());

    expect(actual).toContain('>ST<');
  });

  it('uses the first two characters of a single-word name', () => {
    const actual = buildMonogramSvg(buildOptions({ businessName: 'Zara' }));

    expect(actual).toContain('>ZA<');
  });

  it('keeps Arabic initials intact', () => {
    const actual = buildMonogramSvg(
      buildOptions({ businessName: 'مدينة الألعاب' }),
    );

    expect(actual).toContain('>ما<');
  });

  it('converts the oklch palette to hex so the rasterizer can render it', () => {
    const actual = buildMonogramSvg(buildOptions());

    expect(actual).toContain('fill="#000000"');
    expect(actual).toContain('fill="#ffffff"');
    expect(actual).not.toContain('oklch');
  });

  it('scales the corner radius with the theme radius', () => {
    const actualRounded = buildMonogramSvg(buildOptions({ radius: '1rem' }));
    const actualSharp = buildMonogramSvg(buildOptions({ radius: '0rem' }));

    expect(actualRounded).toContain('rx="128"');
    expect(actualSharp).toContain('rx="0"');
  });

  it('escapes characters that would break the XML', () => {
    const actual = buildMonogramSvg(buildOptions({ businessName: '<b> & co' }));

    expect(actual).not.toContain('><b>');
    expect(actual).toContain('&lt;');
  });
});
