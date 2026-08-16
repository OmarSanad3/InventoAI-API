import { KNOWLEDGE_DOCUMENT_MAX_CHARS } from '../knowledge.constants';
import {
  buildCategoryDocument,
  buildFaqDocument,
  buildProductDocument,
  buildStoreProfileDocument,
  hashDocumentContent,
} from './build-document.util';

describe('buildProductDocument', () => {
  it('composes every part it was given, each labelled', () => {
    const actual = buildProductDocument({
      title: 'Blue Ceramic Mug',
      shortDescription: 'A hand-thrown mug.',
      description: 'Holds 350ml and is dishwasher safe.',
      searchKeywords: 'cup, tumbler',
      categoryNames: ['Kitchen', 'Gifts'],
      descriptiveValues: [{ attribute: 'Material', value: 'Ceramic' }],
    });

    expect(actual).toBe(
      [
        'Product: Blue Ceramic Mug',
        'A hand-thrown mug.',
        'Holds 350ml and is dishwasher safe.',
        'Keywords: cup, tumbler',
        'Categories: Kitchen, Gifts',
        'Material: Ceramic',
      ].join('\n'),
    );
  });

  it('drops the parts that are missing rather than leaving empty labels', () => {
    const actual = buildProductDocument({
      title: 'Plain Mug',
      shortDescription: null,
      description: null,
      searchKeywords: null,
    });

    expect(actual).toBe('Product: Plain Mug');
  });

  it('groups several values under one attribute', () => {
    const actual = buildProductDocument({
      title: 'Mug',
      descriptiveValues: [
        { attribute: 'Material', value: 'Ceramic' },
        { attribute: 'Brand', value: 'Fokhar' },
        { attribute: 'Material', value: 'Stoneware' },
      ],
    });

    expect(actual).toContain('Material: Ceramic, Stoneware');
    expect(actual).toContain('Brand: Fokhar');
  });

  it('collapses whitespace, so a reformat is not a re-embed', () => {
    const inputSpaced = buildProductDocument({
      title: 'Blue   Mug',
      description: 'Line one.\n\n   Line two.',
    });
    const inputTight = buildProductDocument({
      title: 'Blue Mug',
      description: 'Line one. Line two.',
    });

    expect(inputSpaced).toBe(inputTight);
  });

  it('truncates past the cap Gemini would reject', () => {
    const actual = buildProductDocument({
      title: 'Mug',
      description: 'x'.repeat(KNOWLEDGE_DOCUMENT_MAX_CHARS * 2),
    });

    expect(actual).toHaveLength(KNOWLEDGE_DOCUMENT_MAX_CHARS);
  });

  it('keeps Arabic text intact', () => {
    const actual = buildProductDocument({ title: 'عباية سوداء' });

    expect(actual).toBe('Product: عباية سوداء');
  });
});

describe('buildFaqDocument', () => {
  it('labels the question and the answer', () => {
    const actual = buildFaqDocument({
      question: 'Do you deliver to Alexandria?',
      answer: 'Yes, within three days.',
    });

    expect(actual).toBe(
      'FAQ: Do you deliver to Alexandria?\nAnswer: Yes, within three days.',
    );
  });

  it('collapses the line breaks a multi-line answer carries', () => {
    const actual = buildFaqDocument({
      question: 'Returns?',
      answer: 'Within 14 days.\nUnworn only.',
    });

    expect(actual).toBe('FAQ: Returns?\nAnswer: Within 14 days. Unworn only.');
  });
});

describe('buildCategoryDocument', () => {
  it('drops a missing description', () => {
    expect(buildCategoryDocument({ name: 'Kitchen' })).toBe(
      'Category: Kitchen',
    );
  });
});

describe('buildStoreProfileDocument', () => {
  it('composes the store, its description and the questionnaire summary', () => {
    const actual = buildStoreProfileDocument({
      name: 'Layali',
      description: 'Modest wear from Cairo.',
      businessSummary: 'Sells abayas to women aged 20-40.',
    });

    expect(actual).toBe(
      [
        'Store: Layali',
        'About: Modest wear from Cairo.',
        'Business: Sells abayas to women aged 20-40.',
      ].join('\n'),
    );
  });

  it('survives a store that answered nothing', () => {
    expect(buildStoreProfileDocument({ name: 'Draftco' })).toBe(
      'Store: Draftco',
    );
  });
});

describe('hashDocumentContent', () => {
  it('is stable for the same content and different for a change', () => {
    const inputContent = 'Product: Mug';

    expect(hashDocumentContent(inputContent)).toBe(
      hashDocumentContent(inputContent),
    );
    expect(hashDocumentContent(inputContent)).not.toBe(
      hashDocumentContent('Product: Cup'),
    );
  });

  it('returns 64 hex characters', () => {
    expect(hashDocumentContent('anything')).toMatch(/^[0-9a-f]{64}$/);
  });
});
