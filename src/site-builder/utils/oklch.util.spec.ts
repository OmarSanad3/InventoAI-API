import { oklchToHex } from './oklch.util';

describe('oklchToHex', () => {
  it('converts the achromatic extremes', () => {
    expect(oklchToHex('oklch(1 0 0)')).toBe('#ffffff');
    expect(oklchToHex('oklch(0 0 0)')).toBe('#000000');
  });

  it('accepts a percentage lightness and an alpha channel', () => {
    expect(oklchToHex('oklch(100% 0 0)')).toBe('#ffffff');
    expect(oklchToHex('oklch(1 0 0 / 10%)')).toBe('#ffffff');
  });

  it('keeps the hue: a red hue converts to a red-dominant channel', () => {
    const actual = oklchToHex('oklch(0.63 0.26 29)');

    const [, red, green, blue] = /^#(..)(..)(..)$/.exec(actual) ?? [];
    expect(Number.parseInt(red, 16)).toBeGreaterThan(
      Number.parseInt(green, 16),
    );
    expect(Number.parseInt(red, 16)).toBeGreaterThan(Number.parseInt(blue, 16));
  });

  it('falls back to black for anything unparsable', () => {
    expect(oklchToHex('#3b82f6')).toBe('#000000');
    expect(oklchToHex('oklch(nonsense)')).toBe('#000000');
  });
});
