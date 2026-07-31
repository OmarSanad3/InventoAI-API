const HEX_FALLBACK = '#000000';
const SRGB_GAMMA_THRESHOLD = 0.0031308;
const HEX_RADIX = 16;
const MAX_CHANNEL = 255;

/**
 * Converts an `oklch()` colour to a hex string. Needed because the monogram SVG
 * is rasterized by Cloudinary, whose renderer does not understand `oklch()` —
 * everything reaching the SVG has to be plain hex.
 *
 * Returns black for anything unparsable; the caller has already validated the
 * palette, so that only happens for values this project never produces.
 */
export function oklchToHex(color: string): string {
  const parsed = parseOklch(color);
  if (!parsed) {
    return HEX_FALLBACK;
  }

  const { lightness, chroma, hue } = parsed;
  const hueRadians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(hueRadians);
  const b = chroma * Math.sin(hueRadians);

  const longCubeRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mediumCubeRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const shortCubeRoot = lightness - 0.0894841775 * a - 1.291485548 * b;

  const long = longCubeRoot ** 3;
  const medium = mediumCubeRoot ** 3;
  const short = shortCubeRoot ** 3;

  const red =
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short;
  const green =
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short;
  const blue =
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short;

  return `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`;
}

function parseOklch(
  color: string,
): { lightness: number; chroma: number; hue: number } | null {
  const match = /^oklch\(([^)]+)\)$/.exec(color.trim());
  if (!match) {
    return null;
  }

  const [coordinates] = match[1].split('/');
  const parts = coordinates.trim().split(/\s+/);
  if (parts.length < 3) {
    return null;
  }

  const lightness = parsePercentageOrNumber(parts[0]);
  const chroma = Number.parseFloat(parts[1]);
  const hue = Number.parseFloat(parts[2].replace('deg', ''));
  if ([lightness, chroma, hue].some((value) => Number.isNaN(value))) {
    return null;
  }
  return { lightness, chroma, hue };
}

function parsePercentageOrNumber(raw: string): number {
  const value = Number.parseFloat(raw);
  return raw.endsWith('%') ? value / 100 : value;
}

function toHexChannel(linearChannel: number): string {
  const gammaCorrected =
    linearChannel <= SRGB_GAMMA_THRESHOLD
      ? 12.92 * linearChannel
      : 1.055 * linearChannel ** (1 / 2.4) - 0.055;
  const clamped = Math.min(Math.max(gammaCorrected, 0), 1);
  return Math.round(clamped * MAX_CHANNEL)
    .toString(HEX_RADIX)
    .padStart(2, '0');
}
