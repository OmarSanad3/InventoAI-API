import { Schema, Type } from '@google/genai';
import {
  ATTRIBUTE_KEY_MAX_LENGTH,
  ATTRIBUTE_NAME_MAX_LENGTH,
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  CATEGORY_NAME_MAX_LENGTH,
  MAX_GENERATED_ATTRIBUTES,
  MAX_GENERATED_CATEGORIES,
  MIN_GENERATED_CATEGORIES,
  MIN_GENERATED_VALUES_PER_ATTRIBUTE,
  RESERVED_ATTRIBUTE_KEYS,
} from '../catalog.constants';
import { AttributeDisplayStyle } from '../enums/attribute-display-style.enum';

export interface GenerateCatalogPromptOptions {
  readonly storeName: string;
  readonly storeDescription: string | null;
  /** BCP-47-ish tag from `Store.locale`; decides the output language. */
  readonly locale: string;
  /** The questionnaire rendered by `describeAnswers`, or '' when unanswered. */
  readonly business: string;
  /** The owner's steering for a regeneration, e.g. "more categories for kids". */
  readonly instructions?: string;
}

export function buildGenerateCatalogSchema(): Schema {
  return {
    type: Type.OBJECT,
    properties: {
      categories: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            description: { type: Type.STRING },
          },
          required: ['name', 'description'],
        },
      },
      attributes: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            key: { type: Type.STRING },
            isVariantAxis: { type: Type.BOOLEAN },
            displayStyle: {
              type: Type.STRING,
              enum: Object.values(AttributeDisplayStyle),
            },
            values: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  value: { type: Type.STRING },
                  swatchHex: { type: Type.STRING },
                },
                required: ['value'],
              },
            },
          },
          required: ['name', 'key', 'isVariantAxis', 'displayStyle', 'values'],
        },
      },
    },
    required: ['categories', 'attributes'],
  };
}

/**
 * Asks Gemini for the whole catalog scaffold in one call: the categories the
 * navigation needs, and the attributes the store will filter and sell by.
 *
 * Categories and attributes are one decision, not two — "Size" makes sense for
 * a store with an Abayas category and not for one selling ebooks — so they come
 * from a single generation that can see both halves at once.
 *
 * The rules below are tight on purpose: a loose prompt here produces a catalog
 * that looks right and filters wrong.
 */
export function buildGenerateCatalogPrompt({
  storeName,
  storeDescription,
  locale,
  business,
  instructions,
}: GenerateCatalogPromptOptions): string {
  return [
    `Propose the product categories and the filterable product attributes for an online store called "${storeName}".`,
    'This is the shop scaffold — the shelves, not the goods. Do not invent products, prices or stock.',
    '',
    'WHAT WE KNOW ABOUT THE BUSINESS:',
    storeDescription ? `- Store description: ${storeDescription}` : null,
    business || '- (the owner has not answered the questionnaire yet)',
    instructions ? `\nTHE OWNER ALSO ASKED FOR:\n${instructions}` : null,
    '',
    'CATEGORIES:',
    `- Between ${MIN_GENERATED_CATEGORIES} and ${MAX_GENERATED_CATEGORIES} of them, ordered the way the store's navigation should read.`,
    '- Name them as a shopper would browse them, not as a taxonomist would file them.',
    `- name is at most ${CATEGORY_NAME_MAX_LENGTH} characters; description is one short sentence of at most ${CATEGORY_DESCRIPTION_MAX_LENGTH} characters.`,
    '- No duplicates, and no category the business described above would not actually sell.',
    '',
    'ATTRIBUTES:',
    `- Between 0 and ${MAX_GENERATED_ATTRIBUTES}. **Zero is a valid and expected answer**: a bookshop needs no size and no colour, and an attribute nobody will filter by is worse than none.`,
    `- Each attribute needs at least ${MIN_GENERATED_VALUES_PER_ATTRIBUTE} values; one value filters nothing.`,
    '- isVariantAxis is true only for attributes that change price or stock — the ones a shopper picks before buying, such as size or colour. It is false for descriptive attributes such as material, brand or author.',
    `- name is at most ${ATTRIBUTE_NAME_MAX_LENGTH} characters. key is a lowercase ASCII slug of at most ${ATTRIBUTE_KEY_MAX_LENGTH} characters, e.g. "size", "colour", "fabric" — always ASCII, even when the name is not.`,
    `- key must not be one of: ${RESERVED_ATTRIBUTE_KEYS.join(', ')}.`,
    '',
    'HOW EACH ATTRIBUTE RENDERS (displayStyle):',
    `- "${AttributeDisplayStyle.Swatch}" only for colour-like attributes. Then **every** value must carry a swatchHex of the form #RRGGBB that actually matches its name.`,
    `- "${AttributeDisplayStyle.Chip}" for short coded values such as sizes.`,
    `- "${AttributeDisplayStyle.Dropdown}" when there are many values.`,
    `- "${AttributeDisplayStyle.List}" otherwise.`,
    '- Never send swatchHex on an attribute that is not a swatch.',
    '',
    'ORDER AND LANGUAGE:',
    '- The order of the values is the order the shopper sees. Sizes ascend (S, M, L, XL, 2XL) — never alphabetically, never numerically.',
    `- Write every name, description and value in the language of the locale "${locale}". The key stays ASCII regardless.`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
