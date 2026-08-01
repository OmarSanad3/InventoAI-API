import { SpartanPreset } from '../../src/site-builder/enums/spartan-preset.enum';
import { ThemeFont } from '../../src/site-builder/enums/theme-font.enum';
import { StoreStatus } from '../../src/site-builder/enums/store-status.enum';
import type { Palette } from '../../src/site-builder/types/theme';
import { UserRole } from '../../src/users/enums/user-role.enum';

/** One password for every seeded account. Development only, by construction. */
export const SEED_PASSWORD = 'Password123!';

const LIGHT_BASE: Palette = {
  background: 'oklch(1 0 0)',
  foreground: 'oklch(0.145 0 0)',
  card: 'oklch(1 0 0)',
  cardForeground: 'oklch(0.145 0 0)',
  popover: 'oklch(1 0 0)',
  popoverForeground: 'oklch(0.145 0 0)',
  primary: 'oklch(0.55 0.14 250)',
  primaryForeground: 'oklch(0.985 0 0)',
  secondary: 'oklch(0.97 0 0)',
  secondaryForeground: 'oklch(0.205 0 0)',
  muted: 'oklch(0.97 0 0)',
  mutedForeground: 'oklch(0.556 0 0)',
  accent: 'oklch(0.94 0.03 250)',
  accentForeground: 'oklch(0.205 0 0)',
  destructive: 'oklch(0.577 0.245 27)',
  border: 'oklch(0.922 0 0)',
  input: 'oklch(0.922 0 0)',
  ring: 'oklch(0.55 0.14 250)',
  chart1: 'oklch(0.646 0.222 41)',
  chart2: 'oklch(0.6 0.118 185)',
  chart3: 'oklch(0.398 0.07 227)',
  chart4: 'oklch(0.828 0.189 84)',
  chart5: 'oklch(0.769 0.188 70)',
};

const DARK_BASE: Palette = {
  background: 'oklch(0.145 0 0)',
  foreground: 'oklch(0.985 0 0)',
  card: 'oklch(0.205 0 0)',
  cardForeground: 'oklch(0.985 0 0)',
  popover: 'oklch(0.205 0 0)',
  popoverForeground: 'oklch(0.985 0 0)',
  primary: 'oklch(0.7 0.13 250)',
  primaryForeground: 'oklch(0.205 0 0)',
  secondary: 'oklch(0.269 0 0)',
  secondaryForeground: 'oklch(0.985 0 0)',
  muted: 'oklch(0.269 0 0)',
  mutedForeground: 'oklch(0.708 0 0)',
  accent: 'oklch(0.32 0.04 250)',
  accentForeground: 'oklch(0.985 0 0)',
  destructive: 'oklch(0.704 0.191 22)',
  border: 'oklch(1 0 0 / 10%)',
  input: 'oklch(1 0 0 / 15%)',
  ring: 'oklch(0.7 0.13 250)',
  chart1: 'oklch(0.488 0.243 264)',
  chart2: 'oklch(0.696 0.17 162)',
  chart3: 'oklch(0.769 0.188 70)',
  chart4: 'oklch(0.627 0.265 303)',
  chart5: 'oklch(0.645 0.246 16)',
};

/** Re-hues the neutral base so each seeded store looks distinct at a glance. */
function withBrandHue(base: Palette, hue: number, chroma: number): Palette {
  const isDark = base === DARK_BASE;
  return {
    ...base,
    primary: `oklch(${isDark ? 0.7 : 0.55} ${chroma} ${hue})`,
    accent: `oklch(${isDark ? 0.32 : 0.94} ${isDark ? 0.04 : 0.03} ${hue})`,
    ring: `oklch(${isDark ? 0.7 : 0.55} ${chroma} ${hue})`,
  };
}

export interface SeedTheme {
  readonly name: string;
  readonly description: string;
  readonly style: SpartanPreset;
  readonly font: ThemeFont;
  readonly radius: string;
  readonly light: Palette;
  readonly dark: Palette;
}

export interface SeedCategory {
  readonly name: string;
  readonly description: string | null;
  readonly isFeatured?: boolean;
  readonly isPublished?: boolean;
}

export interface SeedStaff {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly role: UserRole;
  readonly isEmailVerified?: boolean;
}

export interface SeedStore {
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly status: StoreStatus;
  readonly currency: string;
  readonly locale: string;
  readonly hero: {
    readonly headline: string;
    readonly subtitle: string;
    readonly ctaLabel: string;
  };
  readonly owner: SeedStaff;
  /** Store-scoped accounts: admins and shoppers. */
  readonly members: readonly SeedStaff[];
  readonly theme: SeedTheme | null;
  readonly categories: readonly SeedCategory[];
}

/**
 * Three stores on purpose: two live ones so cross-tenant isolation can actually
 * be exercised from the client, and a draft so the storefront's 404 path is
 * reachable without editing the database by hand.
 */
export const SEED_STORES: readonly SeedStore[] = [
  {
    name: 'Layali Abayas',
    slug: 'layali',
    description:
      'Modest everyday and occasion wear, made in Cairo. Abayas, hijabs and kaftans.',
    status: StoreStatus.Live,
    currency: 'EGP',
    locale: 'en',
    hero: {
      headline: 'Everyday elegance, made in Cairo',
      subtitle: 'New season abayas and hijabs, cut from breathable crepe.',
      ctaLabel: 'Shop now',
    },
    owner: {
      firstName: 'Layla',
      lastName: 'Hassan',
      email: 'owner.layali@inventoai.test',
      role: UserRole.OWNER,
    },
    members: [
      {
        firstName: 'Mona',
        lastName: 'Adel',
        email: 'admin.layali@inventoai.test',
        role: UserRole.ADMIN,
      },
      {
        firstName: 'Sara',
        lastName: 'Ibrahim',
        email: 'shopper.layali@inventoai.test',
        role: UserRole.USER,
      },
      {
        firstName: 'Nour',
        lastName: 'Kamal',
        email: 'unverified.layali@inventoai.test',
        role: UserRole.USER,
        isEmailVerified: false,
      },
    ],
    theme: {
      name: 'Desert Dusk',
      description: 'Warm sand neutrals with a deep plum accent.',
      style: SpartanPreset.Nova,
      font: ThemeFont.Serif,
      radius: '0.75rem',
      light: withBrandHue(LIGHT_BASE, 330, 0.11),
      dark: withBrandHue(DARK_BASE, 330, 0.11),
    },
    categories: [
      {
        name: 'Abayas',
        description: 'Everyday and occasion abayas',
        isFeatured: true,
      },
      {
        name: 'Hijabs & Scarves',
        description: 'Chiffon, jersey and silk',
        isFeatured: true,
      },
      {
        name: 'Kaftans',
        description: 'Relaxed house and hosting wear',
        isFeatured: true,
      },
      {
        name: 'Accessories',
        description: 'Pins, caps and underscarves',
        isFeatured: false,
      },
      {
        name: 'Sale',
        description: 'End of season',
        isFeatured: false,
        isPublished: false,
      },
    ],
  },
  {
    name: 'Beit El Fokhar',
    slug: 'fokhar',
    description:
      'Hand-thrown pottery and stoneware for the table, from a small studio in Fayoum.',
    status: StoreStatus.Live,
    currency: 'EGP',
    locale: 'en',
    hero: {
      headline: 'Hand-thrown, one at a time',
      subtitle: 'Stoneware for the table, fired in Fayoum.',
      ctaLabel: 'Browse the studio',
    },
    owner: {
      firstName: 'Karim',
      lastName: 'Fouad',
      email: 'owner.fokhar@inventoai.test',
      role: UserRole.OWNER,
    },
    members: [
      {
        firstName: 'Hana',
        lastName: 'Said',
        email: 'shopper.fokhar@inventoai.test',
        role: UserRole.USER,
      },
    ],
    theme: {
      name: 'Kiln',
      description: 'Clay neutrals with a fired-terracotta primary.',
      style: SpartanPreset.Maia,
      font: ThemeFont.Sans,
      radius: '0.5rem',
      light: withBrandHue(LIGHT_BASE, 45, 0.13),
      dark: withBrandHue(DARK_BASE, 45, 0.13),
    },
    categories: [
      {
        name: 'Mugs',
        description: 'Everyday stoneware mugs',
        isFeatured: true,
      },
      {
        name: 'Plates & Bowls',
        description: 'Dinner, side and serving',
        isFeatured: true,
      },
      {
        name: 'Vases',
        description: 'Table and floor vases',
        isFeatured: false,
      },
      { name: 'Gift Sets', description: 'Ready to wrap', isFeatured: true },
    ],
  },
  {
    name: 'Draft Corner',
    slug: 'draftco',
    description: 'A store that was never published — for testing the 404 path.',
    status: StoreStatus.Draft,
    currency: 'EGP',
    locale: 'en',
    hero: {
      headline: 'Coming soon',
      subtitle: 'This store is still a draft.',
      ctaLabel: 'Shop now',
    },
    owner: {
      firstName: 'Omar',
      lastName: 'Draft',
      email: 'owner.draft@inventoai.test',
      role: UserRole.OWNER,
    },
    members: [],
    theme: null,
    categories: [
      {
        name: 'Unreleased',
        description: 'Nothing to see yet',
        isFeatured: false,
      },
    ],
  },
];
