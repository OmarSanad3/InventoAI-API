import { DataSource } from 'typeorm';
import { Faq } from '../../src/faq/entities/faq.entity';
import { SeededStore } from './seed-stores';

/** One store's FAQ entry, kept so the report can print its id. */
export interface SeededFaq {
  readonly storeSlug: string;
  readonly faq: Faq;
}

/**
 * FAQ entries for every seeded store, in fixture order.
 *
 * Written straight through the repository rather than `FaqService`, like the
 * rest of the seed: the service resolves the store from a JWT and there is no
 * request here.
 */
export async function seedFaqs(
  dataSource: DataSource,
  stores: readonly SeededStore[],
): Promise<SeededFaq[]> {
  const repository = dataSource.getRepository(Faq);
  const seeded: SeededFaq[] = [];

  for (const { store, definition } of stores) {
    const rows = definition.faqs.map((faq, index) =>
      repository.create({
        storeId: store.id,
        question: faq.question,
        answer: faq.answer,
        position: index,
        isPublished: faq.isPublished ?? true,
      }),
    );

    for (const faq of await repository.save(rows)) {
      seeded.push({ storeSlug: definition.slug, faq });
    }
  }

  return seeded;
}
