import { Schema, Type } from '@google/genai';
import { SpartanPreset } from '../enums/spartan-preset.enum';
import { ThemeFont } from '../enums/theme-font.enum';
import {
  MAX_HERO_HEADLINE_LENGTH,
  MAX_HERO_SUBTITLE_LENGTH,
  THEMES_PER_BATCH,
} from '../site-builder.constants';
import { QuestionAnswer } from '../types/question-answer';
import { PALETTE_KEYS } from '../types/theme';
import { describeAnswers } from '../utils/describe-answers.util';

export interface GenerateThemesPromptOptions {
  readonly businessName: string;
  readonly answers: readonly QuestionAnswer[];
  readonly hasLogo: boolean;
}

const PALETTE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: Object.fromEntries(
    PALETTE_KEYS.map((key) => [key, { type: Type.STRING }]),
  ),
  required: [...PALETTE_KEYS],
};

export const GENERATE_THEMES_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    storeDescription: { type: Type.STRING },
    heroHeadline: { type: Type.STRING },
    heroSubtitle: { type: Type.STRING },
    themes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          style: { type: Type.STRING, enum: Object.values(SpartanPreset) },
          font: { type: Type.STRING, enum: Object.values(ThemeFont) },
          radius: { type: Type.STRING },
          light: PALETTE_SCHEMA,
          dark: PALETTE_SCHEMA,
        },
        required: [
          'name',
          'description',
          'style',
          'font',
          'radius',
          'light',
          'dark',
        ],
      },
    },
  },
  required: ['storeDescription', 'heroHeadline', 'heroSubtitle', 'themes'],
};

/**
 * Asks Gemini for the store's whole identity in one call: the public
 * description, the landing page's hero copy and a batch of complete themes. All
 * of it comes from the same questionnaire, so pairing them saves round trips.
 * The colour format is stated explicitly because anything that is not `oklch()`
 * is rejected on arrival.
 */
export function buildGenerateThemesPrompt({
  businessName,
  answers,
  hasLogo,
}: GenerateThemesPromptOptions): string {
  return [
    `Write the public description and design ${THEMES_PER_BATCH} distinct visual themes for an online store called "${businessName}".`,
    'Each theme must feel like a deliberate brand decision, not a random palette.',
    '',
    'WHAT THE OWNER TOLD US:',
    describeAnswers(answers),
    hasLogo
      ? '\nThe owner already has a logo, so keep the palette compatible with their stated colour preference.'
      : '\nThe owner has no logo yet, so choose colours that suit the brand personality above.',
    '',
    'RULES:',
    '- storeDescription is what customers read on the storefront: two or three sentences, warm and concrete, addressed to them. No marketing clichés, no emojis, no hashtags.',
    `- heroHeadline is the banner line on the landing page: at most ${MAX_HERO_HEADLINE_LENGTH} characters, specific to this business, not "Welcome to our store".`,
    `- heroSubtitle supports it in one sentence of at most ${MAX_HERO_SUBTITLE_LENGTH} characters.`,
    `- Every colour must be a CSS oklch() string, e.g. "oklch(0.48 0.13 165)".`,
    '- Provide a complete light palette and a complete dark palette for every theme.',
    '- Foreground colours must stay readable on their matching background (aim for a contrast ratio of at least 4.5:1).',
    '- chart1 to chart5 are data-visualisation series colours: distinguishable from each other and drawn from the same brand family.',
    '- radius is a CSS length such as "0.5rem" or "1rem".',
    `- style is the closest matching base preset; font is the family that fits the brand.`,
    '- name is two or three words; description is one sentence explaining who the theme suits.',
    '- Make the themes clearly different from one another in hue and mood.',
  ].join('\n');
}
