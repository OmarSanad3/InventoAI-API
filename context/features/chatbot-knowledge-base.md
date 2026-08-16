# Chatbot Branch 1 — Knowledge Base & Retrieval

> Part of the [Storefront Chatbot](./chatbot.md) epic. Shared decisions live
> there — pgvector over Atlas, Gemini embeddings behind a port, what is embedded
> and what deliberately is not, hybrid retrieval, the tenant rules.

## Overview

Everything the chatbot will retrieve from, and none of the conversation. At the
end of this branch there is no chatbot — there is a `search` a service can call:

```ts
retrieval.search({ storeId, query, sourceTypes, limit })
  → [{ sourceType, sourceId, content, score }]
```

Doing this first is deliberate. It is the branch with the schema risk, the
Docker change, the extension and the dimension count baked into a column type —
all of which are expensive to change once a conversation depends on them, and
all of which can be verified from a dashboard route with no agent in the way.

## Goals

- A store's products, FAQ entries, categories and profile are embedded and
  searchable by meaning, in Arabic and English.
- Retrieval fuses vector similarity with the lexical stack
  [products.md](./products.md) already built.
- An edit to a product or an FAQ shows up in retrieval without anyone
  remembering to press anything.
- Embedding a store's catalog never blocks, slows or breaks a write to it.
- The owner can see the index's state and force a rebuild.

## Non-goals

- The agent, the conversation, the tools, the endpoints — branch 2.
- Chunking long documents. A product description and an FAQ answer are short by
  the schema's own limits; the cap and the deferral are below.
- Re-ranking. RRF, and nothing on top of it.
- Embedding anything the epic's §3 excluded — orders, price, stock.

## Infrastructure

### The Docker image changes

```yaml
db:
  image: pgvector/pgvector:pg15   # was postgres:15-alpine
```

The official Postgres 15 image with pgvector added. Same major version, so the
existing `postgres-data` volume mounts and reads unchanged — no dump, no
restore. It is a larger image (Debian-based, not Alpine); that is the whole
cost.

[SETUP.md](../../SETUP.md) needs a line for the frontend team: pull once,
`docker compose up -d` as before.

### The vector column is not ORM-mapped, on purpose

TypeORM has no `vector` column type, and `synchronize: true` is still how this
project's schema is applied. Rather than fight that — a transformer that lies
about the type, or a hand-patched driver type list — the embedding lives in its
own table that **TypeORM does not manage at all**:

```sql
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  "documentId" uuid PRIMARY KEY
    REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  embedding vector(768) NOT NULL
);
```

No entity, no repository, no metadata. `synchronize` drops columns it does not
recognise from tables it owns, but it does not touch tables it has never heard
of — so the vector survives every boot. Reads and writes are raw
`dataSource.query`, which is what a `<=>` ordering has to be anyway.

The pleasant side effect is that the extension stops being a boot dependency:
`knowledge_documents` is an ordinary table of ordinary columns, so the app
starts and synchronizes with or without pgvector installed. Missing extension
means no vector table, which means retrieval falls back to lexical only — a
degraded chatbot, not a dead API.

### `KnowledgeVectorInitializer`

Same shape and the same warning label as `CatalogSearchInitializer`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS knowledge_embeddings (...);
CREATE INDEX IF NOT EXISTS "IDX_knowledge_embeddings_hnsw"
  ON knowledge_embeddings USING hnsw (embedding vector_cosine_ops);
```

Every statement idempotent, the whole thing wrapped so a refused
`CREATE EXTENSION` (a managed Postgres where the app's role is not superuser) is
logged and swallowed. **A `synchronize`-era stopgap**: when migrations land these
statements become a migration and the class is deleted, exactly as
[ecommerce-core.md §13](./ecommerce-core.md) requires.

One honest note about that index: the tenant filter lives on
`knowledge_documents`, so a filtered search does not get the clean
index-scan-per-store that `IDX_products_search` gets from `btree_gin`. At MVP
volume — hundreds of documents per store, thousands in total — the planner
picks a scan and it is fast either way, and **the `WHERE "storeId" = :storeId`
is the tenant guarantee regardless of which plan runs**. If it ever profiles
badly, the fix is a `storeId` column duplicated onto `knowledge_embeddings` and
a partial or composite index; noted, not built.

## Data model

### `KnowledgeDocument` (new) — `src/knowledge/entities/knowledge-document.entity.ts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | `@BeforeInsert` `randomUUID()` |
| `storeId` | `uuid` | `@ManyToOne(() => Store, { onDelete: 'CASCADE' })` |
| `sourceType` | `enum KnowledgeSourceType` | `product \| faq \| category \| store_profile` |
| `sourceId` | `uuid` | The source row's id; the store's own id for `store_profile` |
| `content` | `text` | The composed document, capped at `KNOWLEDGE_DOCUMENT_MAX_CHARS` |
| `contentHash` | `varchar(64)` | SHA-256 of `content`; what makes a no-op edit free |
| `isStale` | `boolean`, default `true` | Text may have changed since the embedding was written |
| `embeddingModel` | `varchar(100)`, nullable | Which model produced the current vector |
| `indexedAt` | `timestamp`, nullable | `null` = never embedded |
| `failureCount` | `int`, default `0` | Poison rows stop being retried |
| `createdAt` / `updatedAt` | timestamps | |

```ts
@Index('UQ_knowledge_source', ['storeId', 'sourceType', 'sourceId'], { unique: true })
@Index('IDX_knowledge_store_stale', ['storeId', 'isStale'])
```

`content` is stored, not just hashed, for three reasons: the sweeper needs it to
embed, retrieval returns it as the snippet the model reads, and it is the only
way to debug "why did it match that" without re-deriving the composition.

### What a document is made of — `src/knowledge/utils/build-document.util.ts`

Pure functions, one per source type, each returning a plain string. These carry
the epic's §3 decision and are where it can actually be checked, so they are
unit-tested.

| Builder | Composes |
| --- | --- |
| `buildProductDocument` | `title`, `shortDescription`, `description`, `searchKeywords`, category names, **descriptive** attribute value labels |
| `buildFaqDocument` | `question` + `answer` |
| `buildCategoryDocument` | `name` + `description` |
| `buildStoreProfileDocument` | `StoreTheme.description`, plus the `SiteBuildDraft` questionnaire — business type, audience, brand personality |

Rules every builder obeys:

- **No price, no stock, no SKU.** §3 of the epic: the volatile fields are fetched
  live at answer time, so nudging a price never costs an embedding call.
- Variant *axis* labels are excluded too — "S, M, L, XL, 2XL" in the document
  adds nothing a shopper searches by and dilutes the vector. Descriptive
  attributes (Material, Brand, Author) are exactly the ones that do belong.
- A light label prefix on each part (`Product: …`, `Category: …`) so the model
  reading a retrieved snippet knows what it is looking at.
- Truncated to `KNOWLEDGE_DOCUMENT_MAX_CHARS` (4000). Gemini's embedding input
  caps at 2048 tokens, and Arabic tokenises denser than English — 4000
  characters stays inside it in both languages with room to spare.
- Whitespace collapsed before hashing, so a reformat is not a re-embed.

`hashDocumentContent(content)` is SHA-256 hex from `node:crypto`, and it is the
whole freshness optimisation: the sweeper composes the document, hashes it, and
if the hash matches it clears `isStale` without calling anything.

## The embedding provider

`src/knowledge/embedding.provider.ts` declares the port from
[chatbot.md §2](./chatbot.md); `src/knowledge/gemini-embedding.provider.ts` is
the one adapter.

```ts
const response = await this.client.models.embedContent({
  model: this.configService.get('GEMINI_EMBEDDING_MODEL', { infer: true }),
  contents: texts,
  config: {
    taskType: 'RETRIEVAL_DOCUMENT',      // 'RETRIEVAL_QUERY' in embedQuery
    outputDimensionality: this.dimensions,
  },
});
```

- `embedDocuments` batches up to `EMBED_BATCH_SIZE` (32) texts per call — the
  free tier is rate-limited per request, not per text, so batching is the
  difference between one call and thirty-two.
- **Every returned vector is normalised to unit length** before it is stored.
  Only the full 3072-width output arrives normalised; a Matryoshka truncation
  does not, and un-normalised vectors make cosine distances across rows
  incomparable. `normalizeVector` is pure and unit-tested.
- A failed call throws with `AI_UNAVAILABLE_MESSAGE`, exported from
  `GeminiService` — the project already has one wording for an AI outage.
- Retry with backoff on 429/5xx, `MAX_EMBED_ATTEMPTS` (3), then give up and let
  the caller record the failure.

`dimensions` comes from `EMBEDDING_DIMENSIONS` and **must** equal the
`vector(n)` in the initializer. Guard it: the provider logs an error at boot if
the configured value is not 768, because the mismatch shows up as an insert
error per document rather than as anything readable.

## Keeping the index fresh

### Marking stale — a TypeORM subscriber, not scattered calls

Every writer of a source row would otherwise need to remember to mark its
document. There are a lot of them — product create/update/delete, category,
FAQ, theme — and the one that forgets is the one that silently rots the index.

So `KnowledgeSubscriber` implements `EntitySubscriberInterface` for `Product`,
`Faq`, `Category` and `StoreTheme`, and on `afterInsert` / `afterUpdate` /
`afterRemove` / `afterSoftRemove` upserts `(storeId, sourceType, sourceId)` with
`isStale = true`, **through `event.manager`** so the mark lives or dies with the
transaction that caused it.

The subscriber only marks. It composes nothing and calls no AI — composing needs
relations loaded, and doing that inside someone else's transaction is how a save
becomes slow.

Two rules it also enforces, and these are correctness rather than freshness:

- **A row that leaves the storefront leaves the index.** A product moved to
  `draft` or `archived`, an unpublished FAQ, a soft-deleted category — the
  document is **deleted**, not marked stale. A stale document still retrieves;
  a deleted one cannot.
- Deleting a store cascades everything, which the FK already does.

**The caveat, stated plainly:** TypeORM subscribers do not fire for query-builder
bulk writes (`.update()...execute()`), and this codebase uses those — the
conditional stock decrement, the reorder transactions. None of them touch text
that is in a document, so nothing is lost today. It is still a sharp edge, and
the two safety nets below exist because of it.

### The sweeper

`KnowledgeSweeper` runs on `@nestjs/schedule`:

| Job | Cadence | Does |
| --- | --- | --- |
| Incremental | every `KNOWLEDGE_SWEEP_INTERVAL_SECONDS` (60) | Takes up to `KNOWLEDGE_SWEEP_BATCH` (64) stale documents, oldest first, composes, hashes, embeds the ones that changed, clears the flag |
| Reconcile | nightly | Re-derives every store's document set from source rows: inserts what is missing, deletes what no longer qualifies, re-hashes the rest |

The nightly job is the answer to the subscriber's caveat and to anything a seed,
a migration or a manual `UPDATE` did behind the ORM's back. It costs one pass
over rows that are already indexed and, thanks to `contentHash`, close to zero
embedding calls.

`@nestjs/schedule` is the project's first scheduler and
[project-overview.md](../project-overview.md) lists the choice as open. It is
the right one to make here: it is the Nest-native option, it is a decorator over
a provider rather than a new service to run, and the Daily AI Advisor needs the
same thing. A queue (BullMQ on the Redis already running) is the upgrade path
when a job needs to survive a restart or fan out across instances; this one does
not — a missed sweep is picked up by the next one, because the work is a flag in
the database, not a message.

Overlap is prevented twice: an in-process guard, and a Redis lock
(`SET knowledge:sweep:lock <id> NX EX 120`) so two instances do not embed the
same batch. That needs one new method on `RedisService`:

```ts
async setIfAbsent(key: string, value: string, seconds: number): Promise<boolean>
```

The shared plumbing this branch carries, in the epic's tradition of the first
branch carrying it.

`failureCount` is incremented on a document whose embedding failed; past
`MAX_INDEX_FAILURES` (3) it is skipped by the incremental sweep and reported by
the status route. One malformed row must not stall the queue behind it.

## Retrieval

`src/knowledge/retrieval.service.ts`, one public method:

```ts
async search(params: {
  storeId: string;
  query: string;
  sourceTypes?: KnowledgeSourceType[];
  limit?: number;              // default KNOWLEDGE_RETRIEVAL_LIMIT (8)
}): Promise<KnowledgeHit[]>
```

Three steps.

**1. Vector list.** One raw query, ordered by cosine distance:

```sql
SELECT d.id, d."sourceType", d."sourceId", d.content,
       1 - (e.embedding <=> $1::vector) AS score
FROM knowledge_documents d
JOIN knowledge_embeddings e ON e."documentId" = d.id
WHERE d."storeId" = $2
  AND ($3::text[] IS NULL OR d."sourceType" = ANY($3))
ORDER BY e.embedding <=> $1::vector
LIMIT $4
```

`isStale` is **not** a predicate. A document whose text changed an hour ago still
embeds roughly the same meaning, and a slightly old answer beats no answer; the
join to `knowledge_embeddings` already excludes anything never embedded.

**2. Lexical list.** For `product` documents only, the existing
`PublicProductService` search — the `tsvector` ranking, the prefix match and the
trigram fallback that branch 3 of the other epic built and verified. Reusing it
means Arabic exact matches, SKU-shaped queries and typos keep working exactly as
they do on the products page.

**3. Fuse.** `fuseByReciprocalRank` in
`src/knowledge/utils/reciprocal-rank.util.ts` — pure, unit-tested, no database:

```ts
score(doc) = Σ over lists  1 / (RRF_K + rank)      // RRF_K = 60
```

Ranks only, never raw scores: `ts_rank_cd` and cosine similarity share no scale,
and any weighted sum of the two is a tuning exercise that never converges.

### Hits are pointers, not payloads

A `KnowledgeHit` carries `sourceType`, `sourceId`, the snippet and the score. It
carries **no product data** — the caller loads the live row by id through the
service that owns it, with the storefront predicates applied again.

That is the second half of the safety story: even if a stale document survives
for a product that was archived a minute ago, the live load returns nothing and
the hit drops out of the answer. The index can be wrong; the answer cannot.

## Endpoints — `src/knowledge/knowledge.controller.ts`

Dashboard only. No public surface in this branch.

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/knowledge/status` | — | `KnowledgeStatusDto` |
| `POST` | `/knowledge/reindex` | — | `KnowledgeStatusDto` (200) |

`JwtAuthGuard` + `RolesGuard`, `@Roles(OWNER, ADMIN)`, store from
`resolveCallerStore`.

- **`status`** — `total`, `indexed`, `stale`, `failed`, `lastIndexedAt`,
  `vectorSearchAvailable` (false when the extension is missing, which is what
  tells an owner why answers got worse). Counts are one grouped query.
- **`reindex`** — reconciles the caller's store now and marks everything stale;
  the sweeper does the work. Behind a Redis cooldown
  (`KNOWLEDGE_REINDEX_COOLDOWN_SECONDS`, 300) reported the way
  [catalog-ai-setup.md](./catalog-ai-setup.md) reports its 429, naming the
  seconds left via `RedisService.ttl`. It returns 200, not 202 — nothing is
  created and the status body is the useful answer.

## Constants — `src/knowledge/knowledge.constants.ts`

```ts
export const KNOWLEDGE_DOCUMENT_MAX_CHARS = 4000;
export const EMBED_BATCH_SIZE = 32;
export const MAX_EMBED_ATTEMPTS = 3;
export const MAX_INDEX_FAILURES = 3;
export const KNOWLEDGE_SWEEP_INTERVAL_SECONDS = 60;
export const KNOWLEDGE_SWEEP_BATCH = 64;
export const KNOWLEDGE_RETRIEVAL_LIMIT = 8;
export const KNOWLEDGE_MIN_SCORE = 0.35;
export const RRF_K = 60;
export const KNOWLEDGE_REINDEX_COOLDOWN_SECONDS = 300;
export const SWEEP_LOCK_KEY = 'knowledge:sweep:lock';
```

`KNOWLEDGE_MIN_SCORE` is the floor under a vector hit before fusion. Without it
every query returns eight documents, because the nearest neighbour of "1 + 1" is
still *something* — and branch 2's refusal path depends on being able to tell
"nothing relevant" from "here are eight weak matches".

## Environment variables

`GEMINI_EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` — added to
`EnvironmentVariables` with `@IsString()` / `@IsNumber()` and to `.env.example`.
`CHATBOT_*` arrives with branch 2.

## Implementation order

1. `docker compose` image swap, confirm `CREATE EXTENSION vector` succeeds and
   `SELECT '[1,2,3]'::vector` returns.
2. The pure helpers first, with their tests: `buildProductDocument`,
   `buildFaqDocument`, `buildCategoryDocument`, `buildStoreProfileDocument`,
   `hashDocumentContent`, `normalizeVector`, `fuseByReciprocalRank`.
3. `KnowledgeDocument` + `KnowledgeSourceType`, `KnowledgeModule`,
   `KnowledgeVectorInitializer`.
4. `EmbeddingProvider` + `GeminiEmbeddingProvider`, verified by embedding one
   string and asserting length 768 and unit norm.
5. `KnowledgeIndexer` — compose, hash, embed, write; and `reconcile(storeId)`.
6. `KnowledgeSubscriber`, then `KnowledgeSweeper` + `@nestjs/schedule` +
   `RedisService.setIfAbsent`.
7. `RetrievalService` and the two dashboard routes.
8. Seed: index the seeded stores at the end of `npm run seed -- --force` so a
   fresh database has a warm index, and print the per-store document count in
   its summary.

## Tests

Endpoint and behaviour checks, in the project's usual style:

- After `seed`, `GET /knowledge/status` shows `total > 0`, `stale 0`,
  `vectorSearchAvailable true`, and the numbers add up to the store's published
  products + FAQs + categories + 1 profile.
- Retrieval for `"something to keep drinks cold"` returns the store's relevant
  products above its unrelated ones, and **nothing** from the other store.
- Retrieval for an Arabic phrase whose English equivalent is in a title returns
  it — the case the `'english'` text-search config cannot do.
- Editing a product's title flips its document to stale, and within one sweep
  interval retrieval finds it by the new title and not the old.
- Editing a product's **price** flips it stale and the sweep clears it with no
  embedding call — assert `indexedAt` and `embeddingModel` unchanged.
- Moving a product to `draft` removes its document; moving it back re-adds it.
- Deleting an FAQ removes its document.
- A store with an unreachable Gemini key: writes still succeed, `failed` climbs,
  `status` reports it, retrieval still returns lexical hits.
- Dropping the `vector` extension: the app still boots, `status` reports
  `vectorSearchAvailable false`.
- `POST /knowledge/reindex` twice in a row → the second is a 429 naming the
  seconds left; a `USER` token → 403; no token → 401.
- Store B's owner calling `status` sees only their own counts.

## Considered and rejected

- **A `vector` column on the `KnowledgeDocument` entity**, via a TypeORM
  transformer or by patching the postgres driver's type list. It works until
  `synchronize` disagrees about the column type, and then it works differently
  on every developer's machine. An unmanaged table is boring and cannot drift.
- **`PgVectorStore` from `@langchain/community`.** Owns the table's shape, knows
  nothing about `storeId`, product status or soft deletes.
- **Embedding on the write path.** [chatbot.md §9](./chatbot.md): a Gemini round
  trip inside "save product", and an AI outage inside the catalog's uptime.
- **BullMQ for the sweep.** The work is a flag in a table, not a message; a
  missed run is picked up by the next one. Right upgrade, wrong branch.
- **IVFFlat instead of HNSW.** IVFFlat needs training data to build a useful
  index and a new store has none. HNSW builds incrementally.
- **3072 dimensions.** Cannot be HNSW-indexed by pgvector, four times the
  storage, for a recall difference this corpus size cannot notice.
- **Chunking documents.** `shortDescription` is 300 characters and an FAQ answer
  2000; the cap is above both. Revisit if long-form product content appears.
- **One document per variant.** [chatbot.md §3](./chatbot.md).

## Deferred

- Chunking, and per-chunk retrieval with a parent-document join.
- Re-ranking the fused list.
- Duplicating `storeId` onto `knowledge_embeddings` for a tenant-scoped vector
  index, if filtered search ever profiles badly.
- A local embedding adapter behind the same port, for offline development.
- Indexing supplier notes and past chat answers, once those exist.
