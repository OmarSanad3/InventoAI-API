# FAQ Management

> Part of the [E-commerce Core](./ecommerce-core.md) epic. Shared decisions live
> there. Independent of the catalog and order specs — it can land at any point.

## Overview

`inventoai.com/SITENAME/faq` is a page the storefront already promises and the
backend cannot fill. In a normal shop the FAQ is written into the template; in a
store *builder* it is owner-managed data, so it needs a table, an ordering
column and a dashboard.

The smallest spec in the epic, and a good one to do between the two heavy ones.

## Goals

- An owner or admin can write, edit, reorder, unpublish and delete FAQ entries.
- The storefront can render a store's published FAQ in the owner's order.
- The data is shaped so the future chatbot can retrieve from it without a
  migration.

## Non-goals

- **Chatbot retrieval.** The chatbot's FAQ-answering RAG is its own feature.
  This spec only makes sure the rows exist and are clean text.
- **AI-generated FAQ drafts** from the site-builder questionnaire. Obvious next
  step, no AI in this epic.
- **Categorised or grouped FAQs** ("Shipping", "Returns"). Flat list, ordered.
  A `group` column can be added later without touching anything here.
- **Rich text / HTML answers.** Plain text only — see the note below.

## Auth & access control

| Surface | Rule |
| --- | --- |
| `/faqs/**` | `JwtAuthGuard` + `RolesGuard`, `@Roles(OWNER, ADMIN)` |
| `/site/:slug/faqs` | public, no guard |

## Data model

### `Faq` (new) — `src/faq/entities/faq.entity.ts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | `@BeforeInsert` `randomUUID()` |
| `storeId` | `uuid` | `@ManyToOne(() => Store, { onDelete: 'CASCADE' })` |
| `question` | `varchar(300)` | |
| `answer` | `text` | Up to `FAQ_ANSWER_MAX_LENGTH` |
| `position` | `int`, default `0` | Owner-defined order |
| `isPublished` | `boolean`, default `true` | |
| `createdAt` / `updatedAt` | timestamps | |

```ts
@Index('IDX_faqs_store_position', ['storeId', 'position'])
```

No soft delete and no slug. An FAQ entry has no inbound links, nothing
references it, and nobody needs a deleted one back — hard delete is honest here.
This is a deliberate departure from `Category` and `Product`, and the reason is
worth keeping in mind when reading those specs: soft delete exists there because
*orders* point at those rows.

### Plain text, deliberately

`answer` is plain text, rendered as text by the storefront. Accepting HTML would
mean an owner (or a compromised admin account) could inject script into a page
served under the platform's domain, and the project has no sanitiser. If rich
answers are wanted later, add a markdown renderer on the frontend — not raw
HTML from the database.

Line breaks survive; the storefront renders with `white-space: pre-line`.

## Endpoints

### Dashboard

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/faqs` | `CreateFaqDto` | `FaqResponseDto` (201) |
| `GET` | `/faqs` | — | `FaqResponseDto[]` |
| `GET` | `/faqs/:id` | — | `FaqResponseDto` |
| `PATCH` | `/faqs/:id` | `UpdateFaqDto` | `FaqResponseDto` |
| `DELETE` | `/faqs/:id` | — | `MessageResponseDto` |
| `PATCH` | `/faqs/reorder` | `ReorderFaqsDto` | `FaqResponseDto[]` |

`PATCH /faqs/reorder` is declared before `PATCH /faqs/:id`.

Not paginated. A store has a handful of FAQ entries and the dashboard edits them
as one list; `MAX_FAQS_PER_STORE = 100` is enforced on create so "a handful"
stays true.

### Storefront

| Method | Route | Returns |
| --- | --- | --- |
| `GET` | `/site/:slug/faqs` | `FaqPublicDto[]` |

Published entries of a **live** store, ordered by `position ASC, createdAt ASC`.
A draft store 404s, matching `resolvePublicStore`.

## DTOs — `src/faq/dto/`

| File | Shape |
| --- | --- |
| `create-faq.dto.ts` | `question` (`@Length(5, 300)`), `answer` (`@Length(1, 2000)`), `isPublished?` (`@IsBoolean()`) |
| `update-faq.dto.ts` | Same fields, all optional |
| `reorder-faqs.dto.ts` | `items: FaqPositionDto[]` — `@ValidateNested({ each: true })`, `@ArrayMinSize(1)` |
| `faq-response.dto.ts` | `id`, `question`, `answer`, `position`, `isPublished`, timestamps |
| `faq-public.dto.ts` | `question`, `answer` |

No `storeId` on any of them, as everywhere else in this epic.

## Behaviour

- **Create** — `resolveCallerStore(user)`, `position = MAX(position) + 1` within
  the store so a new entry lands at the end, reject past
  `MAX_FAQS_PER_STORE` with a 400.
- **Reorder** — one transaction, every submitted id verified to belong to the
  store before a single write, returns the full re-ordered list. Identical
  pattern to [categories.md](./categories.md); extract it to a shared helper if
  the third caller appears, not before.
- **Delete** — hard, scoped by `storeId`, 404 when it matches nothing.

## Constants — `src/faq/faq.constants.ts`

```ts
export const FAQ_QUESTION_MIN_LENGTH = 5;
export const FAQ_QUESTION_MAX_LENGTH = 300;
export const FAQ_ANSWER_MAX_LENGTH = 2000;
export const MAX_FAQS_PER_STORE = 100;
```

## Implementation order

1. `Faq` entity + index, `FaqModule` registered in `AppModule` (imports
   `AuthModule` and `SiteBuilderModule` for `StoreService`).
2. `FaqService` — create/list/get/update/delete/reorder.
3. DTOs, then `FaqsController`.
4. `PublicFaqController` (`/site/:slug/faqs`).

## Tests

- Create → appears in the dashboard list and, once published, on the storefront.
- Unpublished entry → absent from `/site/:slug/faqs`, present in `/faqs`.
- Draft store slug → `/site/:slug/faqs` 404s.
- Reorder changes the storefront order; a foreign id in the payload → 400 with
  nothing written.
- FAQ of store B by id from store A's owner → 404 on `GET`, `PATCH`, `DELETE`.
- `USER` role token on any `/faqs` route → 403.
- 101st FAQ → 400.
- `<script>` in an answer comes back escaped-as-data, and the storefront renders
  it as text.
- `storeId` in the body → 400 `property storeId should not exist`.

## Considered and rejected

- **Storing the FAQ as a jsonb array on `Store`.** Fewer tables, but reordering
  and editing a single entry become read-modify-write races between two
  dashboard tabs, and the chatbot would later need to retrieve individual
  entries out of a blob.
- **Soft delete, for consistency with `Category` and `Product`.** Consistency
  for its own sake. Nothing references an FAQ row, so there is nothing to
  preserve.
- **Allowing HTML answers.** Stored XSS on the platform's own domain, with no
  sanitiser in the project.

## Deferred

- Grouping FAQs under headings (`group` column).
- AI-drafted FAQ entries from the onboarding questionnaire.
- Chatbot retrieval over these rows, with citations back to the entry.
- Per-locale FAQ text, once Arabic/English i18n lands.
