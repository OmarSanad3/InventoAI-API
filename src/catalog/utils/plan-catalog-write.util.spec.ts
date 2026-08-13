import { CATEGORY_SLUG_FALLBACK } from '../catalog.constants';
import { planCatalogWrite } from './plan-catalog-write.util';

interface TestEntry {
  readonly name: string;
  readonly candidate: string;
  readonly isFallbackCandidate?: boolean;
}

function planEntries(
  entries: readonly TestEntry[],
  existing: readonly { name: string; slug: string }[] = [],
) {
  return planCatalogWrite({
    entries,
    existing,
    identify: (entry) => ({
      name: entry.name,
      candidate: entry.candidate,
      isFallbackCandidate: entry.isFallbackCandidate ?? false,
    }),
  });
}

describe('planCatalogWrite', () => {
  it('creates everything against an empty store', () => {
    const actual = planEntries([
      { name: 'Abayas', candidate: 'abayas' },
      { name: 'Hijabs', candidate: 'hijabs' },
    ]);

    expect(actual.create.map((planned) => planned.slug)).toEqual([
      'abayas',
      'hijabs',
    ]);
    expect(actual.skipped).toEqual([]);
  });

  it('skips an entry the store already has, rather than renaming it', () => {
    const actual = planEntries(
      [
        { name: 'Abayas', candidate: 'abayas' },
        { name: 'Kaftans', candidate: 'kaftans' },
      ],
      [{ name: 'Abayas', slug: 'abayas' }],
    );

    expect(actual.create.map((planned) => planned.slug)).toEqual(['kaftans']);
    expect(actual.skipped).toEqual(['abayas']);
  });

  it('matches an existing name case-insensitively', () => {
    const actual = planEntries(
      [{ name: '  abayas ', candidate: 'abayas' }],
      [{ name: 'Abayas', slug: 'abayas' }],
    );

    expect(actual.create).toEqual([]);
    expect(actual.skipped).toEqual(['abayas']);
  });

  it('skips an entry whose slug is taken even under a different name', () => {
    const actual = planEntries(
      [{ name: 'Abayas', candidate: 'abayas' }],
      [{ name: "Women's Abayas", slug: 'abayas' }],
    );

    expect(actual.create).toEqual([]);
    expect(actual.skipped).toEqual(['abayas']);
  });

  it('skips a name repeated inside one payload', () => {
    const actual = planEntries([
      { name: 'Abayas', candidate: 'abayas' },
      { name: 'ABAYAS', candidate: 'abayas' },
    ]);

    expect(actual.create).toHaveLength(1);
    expect(actual.skipped).toEqual(['abayas']);
  });

  it('applying the same payload twice writes nothing the second time', () => {
    const inputEntries = [
      { name: 'Abayas', candidate: 'abayas' },
      { name: 'Hijabs', candidate: 'hijabs' },
    ];
    const firstPass = planEntries(inputEntries);

    const actual = planEntries(
      inputEntries,
      firstPass.create.map((planned) => ({
        name: planned.entry.name,
        slug: planned.slug,
      })),
    );

    expect(actual.create).toEqual([]);
    expect(actual.skipped).toEqual(['abayas', 'hijabs']);
  });

  describe('names with no Latin characters', () => {
    const arabicEntries: readonly TestEntry[] = [
      {
        name: 'عبايات',
        candidate: CATEGORY_SLUG_FALLBACK,
        isFallbackCandidate: true,
      },
      {
        name: 'أحذية',
        candidate: CATEGORY_SLUG_FALLBACK,
        isFallbackCandidate: true,
      },
    ];

    it('gives two Arabic names two distinct slugs, not one skipped entry', () => {
      const actual = planEntries(arabicEntries);

      expect(actual.create.map((planned) => planned.slug)).toEqual([
        'category',
        'category-2',
      ]);
      expect(actual.skipped).toEqual([]);
    });

    it('still skips them on a second apply, matched by name', () => {
      const firstPass = planEntries(arabicEntries);

      const actual = planEntries(
        arabicEntries,
        firstPass.create.map((planned) => ({
          name: planned.entry.name,
          slug: planned.slug,
        })),
      );

      expect(actual.create).toEqual([]);
      expect(actual.skipped).toHaveLength(2);
    });

    it('does not mistake a new Arabic name for one already applied', () => {
      const actual = planEntries(
        [
          {
            name: 'قمصان',
            candidate: CATEGORY_SLUG_FALLBACK,
            isFallbackCandidate: true,
          },
        ],
        [{ name: 'عبايات', slug: 'category' }],
      );

      expect(actual.create.map((planned) => planned.slug)).toEqual([
        'category-2',
      ]);
      expect(actual.skipped).toEqual([]);
    });
  });
});
