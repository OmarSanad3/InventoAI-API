import { KnowledgeIndexer } from '../../src/knowledge/knowledge-indexer.service';
import { SeededStore } from './seed-stores';

/** One store's index, so the report can print what the chatbot will retrieve from. */
export interface SeededKnowledge {
  readonly storeSlug: string;
  readonly documents: number;
  readonly indexed: number;
  readonly failed: number;
}

/**
 * Passes an unusually high number of sweeps: the seeded corpus is small, and a
 * fresh database should come back fully embedded rather than in the state a
 * minute of sweeping would leave it.
 */
const MAX_SWEEPS = 20;

/**
 * Warms the knowledge base so a freshly seeded database can be retrieved from
 * immediately, instead of waiting a minute per batch for the sweeper.
 *
 * It goes through `KnowledgeIndexer` rather than writing documents itself — the
 * composition rules, the hash and the vector write are the indexer's, and a seed
 * that reimplemented them would be the first place they could start lying.
 *
 * A failure here is reported, never fatal: an unreachable Gemini key must not
 * cost the whole seed, and everything else in the database is already usable.
 */
export async function seedKnowledge(
  indexer: KnowledgeIndexer,
  stores: readonly SeededStore[],
): Promise<SeededKnowledge[]> {
  for (const { store } of stores) {
    await indexer.reconcile(store.id);
  }

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep += 1) {
    const result = await indexer.indexPending();
    if (result.composed === 0) {
      break;
    }
  }

  const seeded: SeededKnowledge[] = [];
  for (const { store, definition } of stores) {
    const counts = await indexer.countDocuments(store.id);
    seeded.push({ storeSlug: definition.slug, ...counts });
  }
  return seeded;
}
