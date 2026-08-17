import { AttributeDisplayStyle } from '../../src/catalog/enums/attribute-display-style.enum';
import { ProductStatus } from '../../src/catalog/enums/product-status.enum';
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

export interface SeedFaq {
  readonly question: string;
  readonly answer: string;
  readonly isPublished?: boolean;
}

export interface SeedAttributeValue {
  readonly value: string;
  /** Required when the attribute is a `swatch`, forbidden otherwise. */
  readonly swatchHex?: string;
}

export interface SeedAttribute {
  readonly name: string;
  /** Omitted means "derive it from the name". */
  readonly key?: string;
  readonly displayStyle: AttributeDisplayStyle;
  /** Size and Colour change price and stock; Fabric and Collection describe. */
  readonly isVariantAxis?: boolean;
  readonly isFilterable?: boolean;
  readonly showOnProductPage?: boolean;
  readonly values: readonly SeedAttributeValue[];
}

export interface SeedVariant {
  /** Unique per store when present. */
  readonly sku?: string;
  /** Minor units — `24900` is 249.00 EGP. */
  readonly priceAmount: number;
  readonly compareAtAmount?: number;
  readonly stockQuantity: number;
  readonly lowStockThreshold?: number;
  /**
   * The axis values this variant is keyed by, as `attributeKey:valueSlug` —
   * `['size:m', 'color:black']`. Qualified rather than bare, because a value
   * slug is only unique inside its own attribute.
   */
  readonly options?: readonly string[];
}

export interface SeedProduct {
  readonly title: string;
  /**
   * Omitted means "derive it from the title" — which is what an owner gets from
   * the API too. Worth setting for a title with no Latin characters at all:
   * `slugifyToken` has nothing to work with there and falls back to `product`.
   */
  readonly slug?: string;
  readonly shortDescription?: string;
  readonly description?: string;
  /** Words shoppers use that the copy does not, weight `B` in the vector. */
  readonly searchKeywords?: string;
  readonly status?: ProductStatus;
  readonly isFeatured?: boolean;
  /** Category slugs. */
  readonly categories?: readonly string[];
  /** Descriptive values, same `attributeKey:valueSlug` form as `options`. */
  readonly attributeValues?: readonly string[];
  readonly variants: readonly SeedVariant[];
}

export interface SeedSupplier {
  readonly name: string;
  readonly contactEmail: string;
  readonly phone?: string;
  readonly leadTimeDays: number;
  /** The owner's own memory of dealing with them. */
  readonly notes?: string;
  readonly isActive?: boolean;
}

/** One supplier's answer, as it stands in the seeded comparison table. */
export interface SeedOffer {
  /** Which supplier answered, by the email they were written to. */
  readonly supplierEmail: string;
  /** Minor units. Omitted means they have not answered at all. */
  readonly unitAmount?: number;
  readonly quantity?: number;
  readonly deliveryDays?: number;
  readonly notes?: string;
  /** What they wrote, so the dashboard has a reply to show beside the numbers. */
  readonly rawReply?: string;
}

export interface SeedPurchaseRequest {
  /** The shelf being reordered, by the variant's seeded SKU. */
  readonly sku: string;
  readonly quantity: number;
  readonly neededWithinDays: number;
  readonly note?: string;
  readonly offers: readonly SeedOffer[];
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
  /**
   * Store-defined facets. Deliberately different per store — that is the whole
   * point of the model, and a client that only ever sees one store's shape will
   * hardcode it.
   */
  readonly attributes: readonly SeedAttribute[];
  /**
   * The catalog itself. Deliberately mixed: simple products and matrices,
   * drafts and archived rows, one product that is only findable through its
   * `searchKeywords`, and an Arabic title — so the frontend meets every case
   * the listing and the search box have to render.
   */
  readonly products: readonly SeedProduct[];
  /**
   * The storefront's FAQ page. One entry per store is left unpublished, so the
   * difference between the dashboard list and the public one is visible without
   * editing a row first.
   */
  readonly faqs: readonly SeedFaq[];
  /**
   * The store's supplier book. One entry per store is inactive, so the rule
   * that a request can only be sent to an active supplier is reachable without
   * editing a row first.
   */
  readonly suppliers: readonly SeedSupplier[];
  /**
   * One purchase request, seeded straight into `replied` with its offers — so
   * the ranked comparison table is visible in the dashboard without SMTP,
   * without Gemini and without waiting for a supplier to write back.
   */
  readonly purchaseRequest?: SeedPurchaseRequest;
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
    faqs: [
      {
        question: 'How long does delivery take?',
        answer:
          'Cairo and Giza: 1–2 working days.\nOther governorates: 3–5 working days.\n' +
          'You get a tracking number by email once the order leaves our workshop.',
      },
      {
        question: 'Can I return an abaya that does not fit?',
        answer:
          'Yes — unworn items with their tags on can be returned within 14 days of ' +
          'delivery. Made-to-measure pieces are the one exception.',
      },
      {
        question: 'كيف أختار المقاس المناسب؟',
        answer:
          'كل منتج يحتوي على جدول مقاسات بالسنتيمتر. لو كنت بين مقاسين، اختاري الأكبر.',
      },
      {
        question: 'Do you ship outside Egypt?',
        answer: 'Not yet. Gulf shipping is coming later this year.',
        isPublished: false,
      },
    ],
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
    // A clothing store: two axes that drive SKU, price and stock, and three
    // descriptive facets that only filter and display.
    attributes: [
      {
        name: 'Size',
        displayStyle: AttributeDisplayStyle.Chip,
        isVariantAxis: true,
        values: [
          { value: 'S' },
          { value: 'M' },
          { value: 'L' },
          { value: 'XL' },
          { value: 'XXL' },
        ],
      },
      {
        name: 'Colour',
        key: 'color',
        displayStyle: AttributeDisplayStyle.Swatch,
        isVariantAxis: true,
        values: [
          { value: 'Black', swatchHex: '#111827' },
          { value: 'Ivory', swatchHex: '#f8f5ef' },
          { value: 'Sand', swatchHex: '#d9c7a7' },
          { value: 'Olive', swatchHex: '#556b2f' },
          { value: 'Burgundy', swatchHex: '#7b1f2b' },
          { value: 'Navy', swatchHex: '#1f2a44' },
        ],
      },
      {
        name: 'Fabric',
        displayStyle: AttributeDisplayStyle.List,
        values: [
          { value: 'Crepe' },
          { value: 'Chiffon' },
          { value: 'Jersey' },
          { value: 'Linen' },
          { value: 'Silk' },
        ],
      },
      {
        name: 'Occasion',
        displayStyle: AttributeDisplayStyle.Dropdown,
        values: [
          { value: 'Everyday' },
          { value: 'Work' },
          { value: 'Eid' },
          { value: 'Wedding' },
        ],
      },
      // Filtered off on purpose: it belongs on the product page's spec table
      // but not in the sidebar, so the client has a case of each.
      {
        name: 'Sleeve Length',
        displayStyle: AttributeDisplayStyle.List,
        isFilterable: false,
        values: [
          { value: 'Full' },
          { value: 'Three-quarter' },
          { value: 'Cap' },
        ],
      },
    ],
    suppliers: [
      {
        name: 'Nile Textiles',
        contactEmail: 'sales@niletextiles.test',
        phone: '+201002223344',
        leadTimeDays: 12,
        notes:
          'Good prices on linen, but they have slipped a week before — ask ' +
          'twice about the delivery date.',
      },
      {
        name: 'Cairo Fabric House',
        contactEmail: 'orders@cairofabric.test',
        phone: '+201115556677',
        leadTimeDays: 7,
        notes: 'Dearer, but they have never missed a date.',
      },
      {
        name: 'Suez Linen Supply',
        contactEmail: 'hello@suezlinen.test',
        leadTimeDays: 15,
      },
      // Inactive on purpose: a request cannot be addressed to them, which is
      // the rule `findActiveByIds` enforces.
      {
        name: 'Delta Trims Co.',
        contactEmail: 'info@deltatrims.test',
        leadTimeDays: 21,
        notes: 'Stopped dealing with them after the 2025 order.',
        isActive: false,
      },
    ],
    /**
     * The shelf the Advisor's own restock insight names — Linen Summer Abaya,
     * Size M — asked of three suppliers.
     *
     * Two have answered and one has not, and the two answers disagree in the
     * way that makes the ranking worth having: the cheaper one arrives after
     * the deadline, so it is flagged `isCheapest` and the dearer, on-time one
     * is `isRecommended`.
     */
    purchaseRequest: {
      sku: 'ABA-LIN-M-SND',
      quantity: 18,
      neededWithinDays: 10,
      note: 'Ask whether the price improves at 30 units.',
      offers: [
        {
          supplierEmail: 'sales@niletextiles.test',
          unitAmount: 42000,
          quantity: 18,
          deliveryDays: 12,
          notes: '400 EGP each if you take 30.',
          rawReply:
            'Dear Layali,\n\nThank you for your enquiry. We can supply the ' +
            'linen abaya at 420 EGP per piece for 18 pieces. Delivery is 12 ' +
            'days from confirmation. If you take 30 pieces the price is 400 ' +
            'EGP each.\n\nBest regards,\nNile Textiles',
        },
        {
          supplierEmail: 'orders@cairofabric.test',
          unitAmount: 46500,
          quantity: 18,
          deliveryDays: 6,
          notes: 'Payment on delivery, no deposit needed.',
          rawReply:
            'Hello,\n\n18 pieces available now. 465 EGP each, delivered ' +
            'within 6 days. Payment on delivery, no deposit needed.\n\n' +
            'Cairo Fabric House',
        },
        // Asked, silent — the row the owner needs to see is still empty.
        { supplierEmail: 'hello@suezlinen.test' },
      ],
    },
    products: [
      {
        title: 'Crepe Everyday Abaya',
        shortDescription: 'The one you reach for every morning.',
        description:
          'A softly draped crepe abaya cut for Cairo weather. Full sleeves, side pockets, and a weight that holds its line without pressing.',
        searchKeywords: 'abaya, عباية, jilbab',
        isFeatured: true,
        categories: ['abayas'],
        attributeValues: [
          'fabric:crepe',
          'occasion:everyday',
          'sleeve-length:full',
        ],
        variants: [
          {
            sku: 'ABA-CRP-S-BLK',
            priceAmount: 89900,
            stockQuantity: 12,
            lowStockThreshold: 3,
            options: ['size:s', 'color:black'],
          },
          {
            sku: 'ABA-CRP-M-BLK',
            priceAmount: 89900,
            stockQuantity: 2,
            lowStockThreshold: 3,
            options: ['size:m', 'color:black'],
          },
          {
            sku: 'ABA-CRP-L-BLK',
            priceAmount: 89900,
            stockQuantity: 0,
            lowStockThreshold: 3,
            options: ['size:l', 'color:black'],
          },
          {
            sku: 'ABA-CRP-S-NVY',
            priceAmount: 94900,
            stockQuantity: 6,
            options: ['size:s', 'color:navy'],
          },
          {
            sku: 'ABA-CRP-M-NVY',
            priceAmount: 94900,
            stockQuantity: 9,
            options: ['size:m', 'color:navy'],
          },
          {
            sku: 'ABA-CRP-L-NVY',
            priceAmount: 94900,
            stockQuantity: 4,
            options: ['size:l', 'color:navy'],
          },
        ],
      },
      {
        title: 'Silk Occasion Kaftan',
        shortDescription: 'For the evening you were saving it for.',
        description:
          'Pure silk with a hand-finished neckline. Cut generously so it moves, and lined where it needs to be.',
        isFeatured: true,
        categories: ['kaftans'],
        attributeValues: [
          'fabric:silk',
          'occasion:wedding',
          'sleeve-length:three-quarter',
        ],
        variants: [
          {
            sku: 'KAF-SLK-S-IVO',
            priceAmount: 189900,
            compareAtAmount: 229900,
            stockQuantity: 3,
            lowStockThreshold: 2,
            options: ['size:s', 'color:ivory'],
          },
          {
            sku: 'KAF-SLK-M-IVO',
            priceAmount: 189900,
            compareAtAmount: 229900,
            stockQuantity: 1,
            lowStockThreshold: 2,
            options: ['size:m', 'color:ivory'],
          },
          {
            sku: 'KAF-SLK-S-BRG',
            priceAmount: 194900,
            stockQuantity: 5,
            options: ['size:s', 'color:burgundy'],
          },
          {
            sku: 'KAF-SLK-M-BRG',
            priceAmount: 194900,
            stockQuantity: 0,
            options: ['size:m', 'color:burgundy'],
          },
        ],
      },
      {
        title: 'Chiffon Hijab',
        shortDescription: 'Weightless chiffon that stays where you put it.',
        searchKeywords: 'scarf, shayla, طرحة',
        isFeatured: true,
        categories: ['hijabs-scarves'],
        attributeValues: ['fabric:chiffon'],
        // One axis only: a hijab has a colour but not a size.
        variants: [
          {
            sku: 'HIJ-CHF-BLK',
            priceAmount: 19900,
            stockQuantity: 40,
            options: ['color:black'],
          },
          {
            sku: 'HIJ-CHF-IVO',
            priceAmount: 19900,
            stockQuantity: 25,
            options: ['color:ivory'],
          },
          {
            sku: 'HIJ-CHF-SND',
            priceAmount: 19900,
            stockQuantity: 4,
            lowStockThreshold: 5,
            options: ['color:sand'],
          },
          {
            sku: 'HIJ-CHF-OLV',
            priceAmount: 21900,
            stockQuantity: 11,
            options: ['color:olive'],
          },
        ],
      },
      {
        title: 'Linen Summer Abaya',
        shortDescription: 'Open-weave linen for the hottest weeks.',
        description:
          'Loose, unlined and breathable. The colour softens with every wash, which is the point.',
        categories: ['abayas'],
        attributeValues: ['fabric:linen', 'occasion:everyday'],
        variants: [
          {
            sku: 'ABA-LIN-M-SND',
            priceAmount: 79900,
            stockQuantity: 7,
            options: ['size:m', 'color:sand'],
          },
          {
            sku: 'ABA-LIN-L-SND',
            priceAmount: 79900,
            stockQuantity: 0,
            options: ['size:l', 'color:sand'],
          },
          {
            sku: 'ABA-LIN-XL-SND',
            priceAmount: 84900,
            stockQuantity: 2,
            lowStockThreshold: 4,
            options: ['size:xl', 'color:sand'],
          },
        ],
      },
      // A simple product: one variant, no axes, and the dashboard hides the
      // array behind a plain price and stock form.
      {
        title: 'Jersey Underscarf Cap',
        shortDescription: 'Stays put all day.',
        categories: ['accessories'],
        attributeValues: ['fabric:jersey'],
        variants: [
          {
            sku: 'ACC-CAP-BLK',
            priceAmount: 8900,
            stockQuantity: 2,
            lowStockThreshold: 5,
          },
        ],
      },
      // Only findable through its keywords — the title says none of it.
      {
        title: 'Magnetic Hijab Pins, Pack of 12',
        shortDescription: 'No holes, no snags.',
        searchKeywords: 'brooch, dabbous, دبوس, magnet',
        categories: ['accessories'],
        variants: [
          { sku: 'ACC-PIN-12', priceAmount: 12900, stockQuantity: 60 },
        ],
      },
      // Arabic: no stemming under the 'english' config, but exact and prefix
      // search work and trigram covers the typos.
      {
        title: 'قميص قطن أحمر للأطفال',
        slug: 'kids-red-cotton-shirt',
        shortDescription: 'قطن مصري ناعم، مقاسات الأطفال',
        searchKeywords: "children's cotton shirt, red",
        categories: ['accessories'],
        variants: [
          { sku: 'KID-SHRT-RED', priceAmount: 15900, stockQuantity: 18 },
        ],
      },
      {
        title: 'Winter Velvet Abaya',
        shortDescription: 'Next season — not on sale yet.',
        status: ProductStatus.Draft,
        categories: ['abayas'],
        variants: [
          {
            priceAmount: 129900,
            stockQuantity: 0,
            options: ['size:m', 'color:burgundy'],
          },
        ],
      },
      {
        title: 'Discontinued Satin Abaya',
        shortDescription: 'We stopped making this one.',
        status: ProductStatus.Archived,
        categories: ['abayas'],
        variants: [
          { sku: 'ABA-SAT-OLD', priceAmount: 69900, stockQuantity: 0 },
        ],
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
    faqs: [
      {
        question: 'Is your stoneware dishwasher safe?',
        answer:
          'Every glazed piece is dishwasher and microwave safe. The matte ' +
          'unglazed vases are hand-wash only.',
      },
      {
        question: 'Why do two mugs of the same design look slightly different?',
        answer:
          'Each piece is thrown and glazed by hand, so small differences in ' +
          'colour and shape are expected — they are not defects.',
      },
      {
        question: 'Do you take custom orders?',
        answer:
          'For 12 pieces or more, yes. Email us and we will quote a lead time.',
        isPublished: false,
      },
    ],
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
    // A different trade with a different shape: the same two axes mean
    // different things, and nothing here is called "Fabric".
    attributes: [
      {
        name: 'Glaze',
        displayStyle: AttributeDisplayStyle.Swatch,
        isVariantAxis: true,
        values: [
          { value: 'Terracotta', swatchHex: '#c96f4a' },
          { value: 'Sand', swatchHex: '#e3d5c0' },
          { value: 'Charcoal', swatchHex: '#3b3b3b' },
          { value: 'Sea Green', swatchHex: '#6b8f7a' },
        ],
      },
      {
        name: 'Size',
        displayStyle: AttributeDisplayStyle.Chip,
        isVariantAxis: true,
        values: [{ value: 'S' }, { value: 'M' }, { value: 'L' }],
      },
      {
        name: 'Collection',
        displayStyle: AttributeDisplayStyle.List,
        values: [{ value: 'Fayoum' }, { value: 'Nile' }, { value: 'Oasis' }],
      },
      {
        name: 'Care',
        displayStyle: AttributeDisplayStyle.List,
        values: [{ value: 'Dishwasher safe' }, { value: 'Hand wash' }],
      },
    ],
    suppliers: [
      {
        name: 'Fayoum Clay Works',
        contactEmail: 'workshop@fayoumclay.test',
        phone: '+201234445566',
        leadTimeDays: 14,
        notes: 'The kiln runs on Tuesdays — order before Monday.',
      },
      {
        name: 'Upper Egypt Ceramics',
        contactEmail: 'sales@uectest.test',
        leadTimeDays: 9,
      },
    ],
    /** Store B's own request, so the cross-tenant checks have two sides. */
    purchaseRequest: {
      sku: 'BWL-NIL-SEA',
      quantity: 24,
      neededWithinDays: 21,
      offers: [
        {
          supplierEmail: 'workshop@fayoumclay.test',
          unitAmount: 31000,
          quantity: 24,
          deliveryDays: 16,
          rawReply:
            'Ahlan,\n\n24 bowls at 310 EGP each, ready in 16 days.\n\n' +
            'Fayoum Clay Works',
        },
        { supplierEmail: 'sales@uectest.test' },
      ],
    },
    products: [
      {
        title: 'Fayoum Stoneware Mug',
        shortDescription: 'Thick-walled, keeps the tea hot.',
        description:
          'Thrown and glazed by hand, so no two are quite the same. Fires to a soft matte the light catches differently through the day.',
        searchKeywords: 'cup, kob, كوب',
        isFeatured: true,
        categories: ['mugs'],
        attributeValues: ['collection:fayoum', 'care:dishwasher-safe'],
        variants: [
          {
            sku: 'MUG-FAY-S-TER',
            priceAmount: 24900,
            stockQuantity: 20,
            options: ['glaze:terracotta', 'size:s'],
          },
          {
            sku: 'MUG-FAY-M-TER',
            priceAmount: 28900,
            stockQuantity: 14,
            options: ['glaze:terracotta', 'size:m'],
          },
          {
            sku: 'MUG-FAY-S-CHR',
            priceAmount: 24900,
            stockQuantity: 3,
            lowStockThreshold: 5,
            options: ['glaze:charcoal', 'size:s'],
          },
          {
            sku: 'MUG-FAY-M-CHR',
            priceAmount: 28900,
            stockQuantity: 0,
            options: ['glaze:charcoal', 'size:m'],
          },
        ],
      },
      {
        title: 'Nile Serving Bowl',
        shortDescription: 'Big enough for the whole table.',
        isFeatured: true,
        categories: ['plates-bowls'],
        attributeValues: ['collection:nile', 'care:hand-wash'],
        variants: [
          {
            sku: 'BWL-NIL-SEA',
            priceAmount: 64900,
            stockQuantity: 6,
            options: ['glaze:sea-green'],
          },
          {
            sku: 'BWL-NIL-SND',
            priceAmount: 64900,
            compareAtAmount: 79900,
            stockQuantity: 2,
            lowStockThreshold: 3,
            options: ['glaze:sand'],
          },
        ],
      },
      {
        title: 'Oasis Table Vase',
        shortDescription: 'Narrow neck, one stem at a time.',
        categories: ['vases'],
        attributeValues: ['collection:oasis', 'care:hand-wash'],
        variants: [{ sku: 'VAS-OAS-01', priceAmount: 89900, stockQuantity: 5 }],
      },
      {
        title: 'Two-Mug Gift Set',
        shortDescription: 'Boxed and ready to give.',
        searchKeywords: 'present, wedding gift, هدية',
        isFeatured: true,
        categories: ['gift-sets', 'mugs'],
        attributeValues: ['collection:fayoum'],
        variants: [{ sku: 'GFT-MUG-2', priceAmount: 52900, stockQuantity: 9 }],
      },
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
    // Published, and still unreachable: the *store* is a draft, so
    // `/site/draftco/faqs` 404s before it ever looks at the entry.
    faqs: [
      {
        question: 'When does this store open?',
        answer: 'Soon.',
      },
    ],
    categories: [
      {
        name: 'Unreleased',
        description: 'Nothing to see yet',
        isFeatured: false,
      },
    ],
    // None on purpose. A mug shop defines nothing and its sidebar shows the
    // built-in filters alone — the client has to render that case too.
    attributes: [],
    // None, and no purchase request either: a store with nothing to sell yet
    // has nobody to buy from.
    suppliers: [],
    // Active, and still unreachable: the *store* is a draft, so every storefront
    // route 404s before it ever looks at the product.
    products: [
      {
        title: 'Unreleased Widget',
        shortDescription: 'Nothing to see yet.',
        status: ProductStatus.Active,
        categories: ['unreleased'],
        variants: [{ priceAmount: 1000, stockQuantity: 1 }],
      },
    ],
  },
];
