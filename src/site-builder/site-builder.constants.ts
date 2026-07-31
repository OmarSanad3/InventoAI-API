import { SiteBuildStep } from './enums/site-build-step.enum';
import { ThemeFont } from './enums/theme-font.enum';

/** Chronological order of the flow; used to compare progress. */
export const SITE_BUILD_STEP_ORDER: readonly SiteBuildStep[] = [
  SiteBuildStep.Brainstormed,
  SiteBuildStep.Answered,
  SiteBuildStep.DomainConfirmed,
  SiteBuildStep.Themed,
  SiteBuildStep.Published,
];

export const BRAINSTORM_MIN_LENGTH = 20;
export const BRAINSTORM_MAX_LENGTH = 2000;

export const LOGO_MAX_SIZE_BYTES = 2 * 1024 * 1024;
export const LOGO_MIME_TYPE_PATTERN = /^image\/(png|jpeg|webp|svg\+xml)$/;
export const LOGO_SUBFOLDER = 'logos';
/** The generated monogram is an SVG; Cloudinary delivers it rasterized. */
export const MONOGRAM_UPLOAD_FORMAT = 'svg';
export const MONOGRAM_DELIVERY_FORMAT = 'png';

export const DEFAULT_LOCALE = 'en';

export const HERO_SUBFOLDER = 'heroes';
export const HERO_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const HERO_MIME_TYPE_PATTERN = /^image\/(png|jpeg|webp)$/;
export const MAX_HERO_HEADLINE_LENGTH = 80;
export const MAX_HERO_SUBTITLE_LENGTH = 200;
export const MAX_HERO_CTA_LABEL_LENGTH = 40;
export const MAX_HERO_CTA_HREF_LENGTH = 2048;
export const DEFAULT_HERO_CTA_LABEL = 'Shop now';

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 30;
export const SLUG_MAX_CONFUSABLE_DISTANCE = 2;
export const SLUG_SUGGESTION_SUFFIXES: readonly string[] = [
  'eg',
  'store',
  'shop',
  'online',
];
export const MAX_SLUG_SUGGESTIONS = 3;
/** How much of a slug is used as the SQL pre-filter before comparing edits. */
export const SLUG_PREFIX_MATCH_LENGTH = 4;
export const SLUG_CANDIDATE_LIMIT = 50;

/** Routes and asset paths that can never be a store slug. */
export const RESERVED_SLUGS: readonly string[] = [
  'api',
  'site',
  'site-builder',
  'admin',
  'auth',
  'users',
  'www',
  'assets',
  'uploads',
  'static',
  'health',
];

export const MAX_STORE_DESCRIPTION_LENGTH = 600;

export const THEMES_PER_BATCH = 4;
export const MIN_VALID_THEMES = 2;
export const MAX_GENERATION_ATTEMPTS = 2;

/** A CSS length the frontend can use for `--radius`. */
export const RADIUS_PATTERN = /^\d+(\.\d+)?(rem|px)$/;

export const MONOGRAM_SIZE_PX = 512;
export const ROOT_FONT_SIZE_PX = 16;

export const FONT_STACKS: Record<ThemeFont, string> = {
  [ThemeFont.Sans]:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  [ThemeFont.Serif]: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  [ThemeFont.Mono]: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};
