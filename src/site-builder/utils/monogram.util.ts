import { ThemeFont } from '../enums/theme-font.enum';
import {
  FONT_STACKS,
  MONOGRAM_SIZE_PX,
  ROOT_FONT_SIZE_PX,
} from '../site-builder.constants';
import { oklchToHex } from './oklch.util';

export interface MonogramOptions {
  readonly businessName: string;
  /** oklch background, normally the selected theme's light `primary`. */
  readonly background: string;
  /** oklch foreground, normally the matching `primaryForeground`. */
  readonly foreground: string;
  readonly font: ThemeFont;
  /** CSS length, e.g. `1rem`. */
  readonly radius: string;
}

const MAX_INITIALS = 2;
const RADIUS_SCALE = 4;
const MAX_CORNER_RATIO = 0.5;
const FONT_SIZE_RATIO = 0.42;

/**
 * Renders the fallback logo for owners who uploaded none: a rounded square in
 * the brand colour with the business initials. Colours are converted to hex
 * because the SVG is rasterized downstream and `oklch()` would not survive.
 */
export function buildMonogramSvg({
  businessName,
  background,
  foreground,
  font,
  radius,
}: MonogramOptions): string {
  const initials = escapeXml(deriveInitials(businessName));
  const corner = toCornerRadius(radius);
  const fontSize = Math.round(MONOGRAM_SIZE_PX * FONT_SIZE_RATIO);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${MONOGRAM_SIZE_PX}" height="${MONOGRAM_SIZE_PX}" viewBox="0 0 ${MONOGRAM_SIZE_PX} ${MONOGRAM_SIZE_PX}">`,
    `<rect width="${MONOGRAM_SIZE_PX}" height="${MONOGRAM_SIZE_PX}" rx="${corner}" ry="${corner}" fill="${oklchToHex(background)}"/>`,
    `<text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="${FONT_STACKS[font]}" font-size="${fontSize}" font-weight="600" fill="${oklchToHex(foreground)}">${initials}</text>`,
    '</svg>',
  ].join('');
}

/**
 * First letter of each of the first two words; a single-word name uses its first
 * two characters. Code-point aware, so Arabic names come out intact.
 */
function deriveInitials(businessName: string): string {
  const words = businessName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  if (words.length === 1) {
    return [...words[0]].slice(0, MAX_INITIALS).join('').toUpperCase();
  }
  return words
    .slice(0, MAX_INITIALS)
    .map((word) => [...word][0])
    .join('')
    .toUpperCase();
}

/** `1rem` reads as a quarter-round tile, `0` as a sharp one. */
function toCornerRadius(radius: string): number {
  const value = Number.parseFloat(radius);
  if (Number.isNaN(value)) {
    return 0;
  }
  const remValue = radius.trim().endsWith('px')
    ? value / ROOT_FONT_SIZE_PX
    : value;
  const ratio = Math.min(remValue / RADIUS_SCALE, MAX_CORNER_RATIO);
  return Math.round(MONOGRAM_SIZE_PX * Math.max(ratio, 0));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
