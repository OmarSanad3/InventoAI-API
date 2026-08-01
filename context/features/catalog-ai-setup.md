# AI Catalog Setup

> Part of the [E-commerce Core](./ecommerce-core.md) epic. Depends on
> [categories.md](./categories.md) and
> [product-attributes.md](./product-attributes.md) — it writes through their
> services and adds no entity of its own. Independent of
> [products.md](./products.md).

## Overview

The site builder already turns a questionnaire into a brand: logo, description,
theme. It stops at the shop door. The owner then faces two empty tables and has
to invent their own navigation and their own filters before they can add a
single product — which is exactly the "going online is a technical wall" problem
[project-overview.md](../project-overview.md) says the platform exists to remove.

This spec closes that gap. **One generation** reads the answers the owner
already gave and proposes the whole catalog scaffold:

- the **categories** the store's navigation should have, and
- the **attributes** it will filter and sell by — with their values, in order,
  and with the display style each one should render as.

An abaya shop gets Size (S–2XL as neutral chips) and Colour (as coloured
circles). A bookshop gets Author and Language as plain lists, and no size
anywhere. Neither owner had to know what a "facet" is.

## Goals

- One call turns the questionnaire into a complete catalog scaffold: categories
  **and** attributes **and** values **and** how each renders.
- The owner previews it, edits it, drops what they do not want, and only then is
  anything written.
- Regeneration is cheap and can be steered ("more categories for kids").
- Applying twice never duplicates anything.
- Nothing the model returns reaches the database unvalidated.

## Non-goals

- **Generating products.** Titles, prices and stock are the owner's real
  business data; inventing them produces a store full of plausible lies. The
  scaffold is the shelves, not the goods.
- **Generating the FAQ** — [faq.md](./faq.md) is its own surface, and the same
  pattern applies there later.
- **Images** for the generated categories. The category image stays an upload;
  AI image generation for the catalog is a separate, expensive feature.
- **Continuous suggestions** ("you should add a Brand filter") — that is the
  Daily AI Advisor's job, not onboarding's.
- **Auto-applying without review.** See the decision below.

## The one decision: propose, never write

`POST /catalog/generate` **persists nothing**. It returns a proposal. A second
call, `POST /catalog/apply`, writes what the owner kept.

The alternative — generate straight into the tables — is one fewer round trip
and wrong for three reasons:

1. The owner may already have categories. A generation that lands directly is
   either a merge with no review or a silent overwrite of real work.
2. `isVariantAxis` is immutable once products use it
   ([product-attributes.md](./product-attributes.md)). Letting a model set it
   unreviewed hands an irreversible decision to a temperature parameter.
3. "AI revises on request" is a stated product behaviour. Revision means the
   previous attempt was never authoritative.

The proposal is not stored server-side either. The client holds it, the owner
edits it, and it comes back as a normal validated DTO — which the server
re-checks from scratch, because by then it is untrusted client input like any
other.

## Auth & access control

| Surface | Rule |
| --- | --- |
| `/catalog/generate` | `JwtAuthGuard` + `RolesGuard`, `@Roles(OWNER, ADMIN)` |
| `/catalog/apply` | `JwtAuthGuard` + `RolesGuard`, `@Roles(OWNER, ADMIN)` |

Both resolve the store with `resolveCallerStore`, like every other dashboard
route. No public surface.

## Endpoints

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/catalog/generate` | `GenerateCatalogDto` | `CatalogProposalDto` |
| `POST` | `/catalog/apply` | `ApplyCatalogDto` | `ApplyCatalogResultDto` |

### `POST /catalog/generate`

```json
{ "instructions": "more categories for kids, we don't sell shoes" }
```

`instructions` is optional, ≤ `MAX_GENERATION_INSTRUCTIONS_LENGTH`, and is what
makes regeneration steerable. Everything else the prompt needs comes from the
server: the store's `SiteBuildDraft` answers, its name and its description.

Nothing about the business comes from the request body. The owner cannot inject
a different business into the prompt, and more usefully, the frontend does not
have to re-send data the backend already stores.

**Behind a cooldown.** Gemini calls cost money and this is a button an
impatient owner will click repeatedly. A Redis key
`catalog-gen:<storeId>` with `CATALOG_GENERATION_COOLDOWN_SECONDS` TTL, set
*before* the call, mirroring the resend-OTP cooldown that already exists. A
second call inside the window is a 429 naming the seconds left.

Response:

```json
{
  "categories": [
    { "name": "Abayas", "description": "Everyday and occasion abayas" },
    { "name": "Hijabs & Scarves", "description": "..." }
  ],
  "attributes": [
    {
      "name": "Size", "key": "size",
      "isVariantAxis": true, "displayStyle": "chip",
      "values": [
        { "value": "S" }, { "value": "M" }, { "value": "L" },
        { "value": "XL" }, { "value": "2XL" }
      ]
    },
    {
      "name": "Colour", "key": "colour",
      "isVariantAxis": true, "displayStyle": "swatch",
      "values": [
        { "value": "Black", "swatchHex": "#111827" },
        { "value": "Beige", "swatchHex": "#d6c7ae" }
      ]
    },
    {
      "name": "Fabric", "key": "fabric",
      "isVariantAxis": false, "displayStyle": "list",
      "values": [{ "value": "Crepe" }, { "value": "Linen" }]
    }
  ]
}
```

Two details in that payload carry real weight:

- **Array order is `position`.** Sizes must read S, M, L, XL, 2XL — an order no
  alphabetical or numeric sort produces. The model returns them correctly
  ordered because it understands sizes; the server just assigns `position` by
  index and never sorts. This is the cheapest correct solution to a problem that
  otherwise needs a hand-maintained size lexicon.
- **`displayStyle` is chosen per attribute, not guessed by the client.** Colour
  comes back as `swatch` with a hex on every value; Size as `chip`; Fabric as
  `list`. That is exactly the rendering contract in
  [product-attributes.md](./product-attributes.md), decided at generation time
  by the only party that knows a colour from a size.

### `POST /catalog/apply`

The edited proposal, sent back in full. Same shape as the response above, with
every field re-validated by the same rules as the hand-driven create DTOs —
name lengths, reserved keys, the `swatch`/`swatchHex` pairing, the caps.

```json
{
  "categories": [{ "name": "Abayas", "description": "..." }],
  "attributes": [{ "name": "Size", "isVariantAxis": true, "displayStyle": "chip",
                   "values": [{ "value": "S" }] }]
}
```

Both arrays are optional and may be empty — an owner who wants only the
attributes sends only the attributes.

Written in **one transaction** through `CategoryService` and
`ProductAttributeService`, so a bad attribute cannot leave half a catalog
behind.

**Idempotent by slug/key.** An entry whose slug or key already exists in the
store is *skipped*, not renamed. This is the one place the normal
de-duplication is wrong: applying twice must not produce `abayas-2`, because
the owner clicked the same button twice, not created a second category. The
result says which were created and which were skipped:

```json
{
  "categoriesCreated": 6, "categoriesSkipped": 2,
  "attributesCreated": 3, "attributesSkipped": 0,
  "skipped": ["abayas", "size"]
}
```

## Prompt & schema — `src/catalog/prompts/generate-catalog.prompt.ts`

Follows the shape `generate-themes.prompt.ts` already established:
`buildGenerateCatalogPrompt(input)` and `buildGenerateCatalogSchema()`, passed
to `GeminiService.generateJson<T>({ prompt, schema, temperature })`.

The prompt is given the business description built from the questionnaire —
reuse `describeAnswers` from `src/site-builder/utils/describe-answers.util.ts`
rather than re-deriving it — plus the store name, its description, its `locale`,
and the owner's `instructions`.

What the prompt must pin down, because a loose prompt here produces a catalog
that looks right and filters wrong:

- Between `MIN_GENERATED_CATEGORIES` and `MAX_GENERATED_CATEGORIES` categories,
  named as a shopper would browse them, not as a taxonomist would file them.
- Between `0` and `MAX_GENERATED_ATTRIBUTES` attributes. **Zero is a valid and
  expected answer** — a bookshop needs no size, and a model that always returns
  three attributes gives every store a Colour filter it will never use. Say so
  explicitly in the prompt.
- `isVariantAxis` is `true` only for attributes that change price or stock
  (size, colour), `false` for descriptive ones (material, brand, author).
- `displayStyle`: `swatch` only for colour-like attributes, and then **every**
  value carries a `#RRGGBB` that actually matches its name; `chip` for short
  coded values like sizes; `list` otherwise; `dropdown` when there are many
  values.
- Values ordered the way a shopper expects — sizes ascending, never
  alphabetical.
- Output language follows the store's `locale`, so an Arabic store gets Arabic
  category names. The `key`/`slug` is still ASCII: `slugify()` falls back to
  `SLUG_FALLBACK` on a name with no Latin characters, so the service must
  de-duplicate the fallback rather than create five attributes keyed
  `my-store`. **This is the one real trap in this spec** — call it out in the
  code, and test it with Arabic names.

## Validating what comes back

The structured-output schema makes the parse a formality, not the defence —
`GeminiService` says as much. Everything below runs on the parsed object before
it is returned as a proposal, and again on apply:

| Check | On failure |
| --- | --- |
| Category name length, after trim | drop that category |
| Duplicate category name, case-insensitive | drop the later one |
| Attribute name/key length, reserved key | drop that attribute |
| Duplicate attribute key | drop the later one |
| Fewer than 2 or more than `MAX_VALUES_PER_ATTRIBUTE` values | drop that attribute |
| Duplicate value within an attribute | drop the later value |
| `displayStyle` not a valid enum member | coerce to `list` |
| `swatch` with any value missing a valid hex | coerce the attribute to `chip` and strip the hexes |
| Non-`swatch` with hexes | strip the hexes |
| Nothing valid survives | retry once, then 503 |

Dropping beats rejecting: one malformed value must not cost the owner the other
eleven. The retry mirrors `MAX_GENERATION_ATTEMPTS` in the theme generator, and
the final 503 uses the message `GeminiService` already returns for an outage.

`sanitizeGeneratedCatalog(raw)` is a pure function taking the parsed object and
returning the proposal. No repository, no network — and therefore the place
every one of these rules is unit-tested.

## Constants — added to `src/catalog/catalog.constants.ts`

```ts
export const MIN_GENERATED_CATEGORIES = 3;
export const MAX_GENERATED_CATEGORIES = 12;
export const MAX_GENERATED_ATTRIBUTES = 6;
export const MAX_GENERATION_INSTRUCTIONS_LENGTH = 500;
export const CATALOG_GENERATION_COOLDOWN_SECONDS = 30;
export const CATALOG_GENERATION_ATTEMPTS = 2;
```

No new environment variables — `GEMINI_API_KEY` and `GEMINI_MODEL` are already
validated in `env.validation.ts`, and the cooldown is a constant rather than a
knob because nobody will tune it per deployment.

## Implementation order

1. `generate-catalog.prompt.ts` — prompt builder and response schema.
2. `sanitizeGeneratedCatalog` as a pure function, with its unit tests. Write
   these first; they are the whole correctness story.
3. `CatalogAiService` — the cooldown, the Gemini call, the retry, the sanitiser.
4. `SiteBuilderService.describeBusinessForOwner(ownerId)` exposed and
   `SiteBuilderService` exported from `SiteBuilderModule` so the catalog can
   read the questionnaire. `CatalogModule` already imports it.
5. DTOs, then `CatalogSetupController` with both routes.
6. `applyCatalog` — the transaction, the skip-by-slug rule, the result DTO.

## Tests

Unit (pure, no database, no network — mock the Gemini response):

- `sanitizeGeneratedCatalog` against every row of the validation table above.
- A `swatch` attribute with one bad hex → becomes a `chip`, hexes stripped.
- Value order is preserved as `position`: `["S","M","L","XL","2XL"]` maps to
  positions 0–4.
- Two Arabic category names → two distinct keys, not two `my-store`s.
- An empty `attributes` array is valid and returns a proposal with no
  attributes.

Endpoint checks:

- Generate for a clothing questionnaire → Size as `chip`, Colour as `swatch`
  with hexes on every value.
- Generate for a bookshop → no size attribute.
- Generate twice inside the cooldown → 429 naming the seconds remaining.
- Apply → the categories appear in `GET /categories` and the attributes in
  `GET /product-attributes`, with values in the submitted order.
- **Apply the same payload twice → nothing duplicated**, the second result
  reports everything skipped, and no `abayas-2` exists.
- Apply with a reserved key (`category`) → 400.
- Apply with `swatchHex` on a `chip` attribute → 400.
- Apply where one attribute is invalid → 400 and **no** categories written
  either, proving the transaction.
- Store B's owner cannot generate or apply into store A (the epic-wide
  cross-tenant test).
- Gemini unavailable → 503 with the existing message, and the cooldown key is
  still cleared enough to allow a retry.

## Considered and rejected

- **Generating into the tables directly.** See the decision above.
- **Storing the proposal server-side** (Redis, keyed by store) so apply sends
  only an id. Fewer bytes on the wire and it would stop the client tampering —
  but the client is *supposed* to tamper: the owner edits the proposal before
  applying. Since it must be re-validated either way, the stateless round trip
  is strictly simpler.
- **Renaming on apply instead of skipping.** Uses the de-duplication that
  already exists, but turns a double-click into `abayas-2` and an owner asking
  why they have two of everything.
- **One prompt per concern** (categories, then attributes). Cleaner prompts, but
  two Gemini calls, two failure modes, and — the real problem — the attributes
  would not know the categories. Size makes sense for a store with an "Abayas"
  category and not for one with "Ebooks". They are one decision and belong in
  one generation, which is what was asked for.
- **Letting the client pass the business description.** Saves a lookup, lets any
  admin prompt-inject an unrelated business, and desynchronises the catalog from
  the brand the theme was built on.

## Deferred

- Generating the FAQ in the same call — the natural next step once
  [faq.md](./faq.md) lands.
- Suggesting *additional* attributes later, once the store has products and the
  Advisor has chatbot logs to mine.
- Generating category images.
- Per-category attribute suggestions ("Size applies to Abayas, not Perfumes"),
  which needs per-category attributes to exist at all.
