# Site Building

## Overview

The onboarding phase an owner goes through right after creating their account.
It turns a free-form "everything in my head" paragraph into a live store:

```
brainstorm (+ optional logo)
   → AI pre-fills the onboarding questionnaire
   → owner edits & submits the answers
   → owner confirms the domain (store slug)
   → AI generates theme suggestions
   → owner picks one and publishes
   → store is reachable at /site/:slug
```

Only the **owner** of an account runs this flow, and (for the MVP) an owner
builds **one** store. Everything produced here is stored as structured data —
never rendered HTML — because the Angular frontend does the rendering
(spartan/ui + Tailwind CSS variables).

Scope of this document: the site-builder module only. Products, filters, orders
and the storefront pages beyond "resolve the slug" are separate features.

## Goals

- Persist the brainstorm, the logo and the questionnaire answers per owner.
- Call Gemini exactly twice per build: once to pre-fill the answers, once for the
  store description, the hero copy and the themes together.
- Validate AI output hard — a malformed theme must never reach the database.
- Create the `Store` (name + unique slug) and flip it `draft → live` on publish.
- Always end up with a logo: the upload, or a generated monogram fallback.
- Serve the published store's branding + theme at a public, slug-scoped route.
- Make every step resumable: the owner can close the tab and come back.

## Non-goals (for this feature)

- Partial regeneration ("new colors only", "make it warmer") — the owner re-runs
  step 4 for a whole new batch. See [Deferred improvements](#deferred-improvements).
- Slug renaming after publish — the slug is permanent.
- Product management, filters, storefront pages.
- Multiple stores per owner.

---

## Auth & access control

| Route | Access |
| --- | --- |
| `GET  /site-builder/questions` | authenticated |
| `POST /site-builder/brainstorm` | `OWNER` |
| `POST /site-builder/answers` | `OWNER` |
| `POST /site-builder/domain` | `OWNER` |
| `POST /site-builder/themes` | `OWNER` |
| `GET  /site-builder/themes` | `OWNER` |
| `POST /site-builder/publish` | `OWNER` |
| `PATCH /stores/me/hero` | `OWNER` |
| `GET  /site/:slug` | **public** |

All non-public routes use `@UseGuards(JwtAuthGuard)` and read the caller with
`@CurrentUser()`. The draft is always looked up by `user.sub` — the client never
sends an owner or store id, so there is nothing to tamper with.

> **Dependency:** there is no role guard in the codebase yet (see
> [current-feature.md](../current-feature.md) → known gaps). A `RolesGuard` +
> `@Roles(UserRole.OWNER)` decorator in `src/common/` must land before or with
> this feature, otherwise any `USER` can build a store.

---

## New environment variables

Per [CLAUDE.md](../../CLAUDE.md), each one needs a field on `EnvironmentVariables`
in [src/config/env.validation.ts](../../src/config/env.validation.ts) **and** a
line in `.env.example`, or the app won't boot.

| Var | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Gemini auth |
| `GEMINI_MODEL` | model id, so it can be swapped without a code change |
| `CLOUDINARY_CLOUD_NAME` | image hosting (logos) |
| `CLOUDINARY_API_KEY` | |
| `CLOUDINARY_API_SECRET` | |
| `CLOUDINARY_FOLDER` | asset prefix, e.g. `inventoai/logos` |
| `SITE_BASE_URL` | used to build the `storeUrl` returned to clients |

---

## Data model

### `SiteBuildDraft` (new)

Everything before publish lives in one row, one per owner (`ownerId` unique).
Postgres rather than Redis: the flow spans several sessions and losing a
brainstorm to a TTL is not acceptable.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | `@PrimaryColumn` + `@BeforeInsert` `randomUUID()` (project convention) |
| `ownerId` | `uuid` | FK → `User`, unique |
| `brainstorm` | `text` | raw owner input |
| `logoUrl` | `varchar` nullable | Cloudinary secure URL, set when a logo was uploaded |
| `logoPublicId` | `varchar` nullable | Cloudinary public id, needed to replace/delete |
| `answers` | `jsonb` nullable | `QuestionAnswer[]`, written by step 1, overwritten by step 2 |
| `businessName` | `varchar` nullable | from `q1` after step 2 |
| `description` | `text` nullable | AI-written store description, generated in step 4 alongside the themes |
| `heroHeadline` | `varchar` nullable | AI-drafted in step 4 |
| `heroSubtitle` | `varchar` nullable | AI-drafted in step 4 |
| `slug` | `varchar` nullable | confirmed in step 3 |
| `step` | `enum` | `brainstormed \| answered \| domain_confirmed \| themed \| published` |
| timestamps | | |

`step` is the resumability marker: the frontend can `GET` the draft and jump the
owner back to where they stopped. Each endpoint rejects calls that arrive out of
order with `409 Conflict`.

### `Store` (new)

Created at **step 3** (the first moment a unique slug exists) and referenced by
every other module later.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | |
| `ownerId` | `uuid` | FK → `User`, unique for MVP |
| `name` | `varchar` | the confirmed business name |
| `slug` | `varchar` | **unique index**, lowercase, immutable once published |
| `description` | `text` nullable | AI-written store description |
| `logoUrl` | `varchar` nullable | Cloudinary URL — upload or generated monogram |
| `logoPublicId` | `varchar` nullable | |
| `logoSource` | `enum` | `uploaded \| monogram` |
| `heroImageUrl` | `varchar` nullable | uploaded from the dashboard |
| `heroImagePublicId` | `varchar` nullable | |
| `heroHeadline` | `varchar` nullable | AI-drafted at publish, owner-editable |
| `heroSubtitle` | `varchar` nullable | AI-drafted at publish, owner-editable |
| `heroCtaLabel` | `varchar` nullable | defaults to `Shop now` at publish |
| `heroCtaHref` | `varchar` nullable | owner-set; no products route to point at yet |
| `status` | `enum` | `draft \| live` — `live` only after publish |
| `locale` | `varchar` | `en` \| `ar`, default `en` |
| timestamps | | |

### `StoreTheme` (new)

One row per AI-suggested theme, so the client can select by id and so a later
regeneration keeps history.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | the `themeId` the client sends back |
| `storeId` | `uuid` | FK → `Store` |
| `name` | `varchar` | e.g. `Verdant Calm` |
| `description` | `varchar` | one-line rationale, shown in the picker |
| `style` | `enum` | spartan base preset |
| `font` | `enum` | `sans \| serif \| mono` |
| `radius` | `varchar` | CSS length, e.g. `1rem` |
| `light` | `jsonb` | `Palette` |
| `dark` | `jsonb` | `Palette` |
| `isSelected` | `boolean` | exactly one true per store |
| `generation` | `int` | bumped on every regeneration batch |

Storing the structured `Theme` (not the CSS) is deliberate: CSS is derived on
read by `buildThemeCss` (see [Theme contract](#theme-contract)), so a change to
the token set doesn't require a data migration.

---

## The flow

### Step 0 — question catalog

The AI answers questions *by id*, so the client needs the catalog to render
them. This endpoint was missing from the original plan.

```
GET /site-builder/questions
```

```jsonc
{
  "questions": [
    { "id": "q1", "label": "What's your business name?", "type": "text", "required": true },
    { "id": "q4", "label": "What's your price range?", "type": "multi",
      "options": ["Budget", "Mid-range", "Premium", "Luxury"], "required": true },
    { "id": "q7", "label": "Your preferred color?", "type": "single",
      "options": ["Blue", "Red", "…", "Let AI choose"], "required": false,
      "showWhen": "logoUploaded" }
  ]
}
```

The catalog is a **constant** in `src/site-builder/constants/onboarding-questions.ts`
(`as const`), not a table — it is versioned with the code and the AI prompt is
built from it. See [Question catalog](#question-catalog) for the full list.

### Step 1 — brainstorm

```
POST /site-builder/brainstorm
Content-Type: multipart/form-data
```

| Field | Rules |
| --- | --- |
| `brainstorm` | string, required, 20–2000 chars |
| `logo` | file, optional, `image/png\|jpeg\|webp\|svg+xml`, ≤ 2 MB |

Behaviour:

1. Upload the logo (if any) to Cloudinary; keep `secure_url` + `public_id`. On
   re-upload, destroy the previous `public_id` so drafts don't leak assets.
2. Ask Gemini to fill the questionnaire from the brainstorm text, constrained to
   the catalog: free-text answers for `text`, an **option index** for `single`,
   an **array of option indexes** for `multi`.
3. `q7` is included in the prompt only when a logo was uploaded.
4. Upsert the draft (`step = brainstormed`) and return the answers.

Response:

```jsonc
{
  "questions": [
    { "questionId": "q1", "answer": "Sanad Toys" },       // text
    { "questionId": "q5", "answer": 1 },                  // single → option index
    { "questionId": "q4", "answer": [0, 1] },             // multi  → option indexes
    { "questionId": "q3", "answer": null }                // not inferable → left blank
  ]
}
```

`answer: null` is explicit — "not all questions have answers" means the field is
present and null, not absent, so the client can render an empty control without
guessing. Calling this endpoint again replaces the draft's brainstorm, logo and
answers (owners will retry).

Failure modes: Gemini unreachable/invalid JSON after retries → `503`, but the
brainstorm and logo are still saved so the owner can fall back to filling the
questionnaire by hand.

### Step 2 — submit answers

```
POST /site-builder/answers
```

```jsonc
{
  "questions": [
    { "questionId": "q1", "answer": "Sanad Toys" },
    { "questionId": "q5", "answer": 1 },
    { "questionId": "q4", "answer": [0, 1] }
  ]
}
```

Validation (a discriminated DTO, validated against the catalog — not just
"is a string"):

- unknown `questionId` → `400`
- answer type ≠ the question's type → `400`
- index out of range for `single`/`multi` → `400`
- missing required question → `400`
- `q7` sent without a logo on the draft → `400`

Response:

```jsonc
{
  "businessName": "Sanad Toys",
  "suggestedDomain": "sanad-toys",
  "hint": null
}
```

Side effects: the answers and `businessName` are saved on the draft;
`step = answered`. No AI call — this step is a pure validation-and-save.

`suggestedDomain` is the slugified business name, pre-filled into the domain
input in step 3. `hint` is the near-collision advisory described below — computed
here for the suggested domain, and again in step 3 for whatever the owner
actually typed.

### Step 3 — confirm domain

```
POST /site-builder/domain
```

```jsonc
{ "businessName": "Sanad Toys", "domain": "toys-city" }
```

Slug rules (enforced by DTO + a `@IsSlug()` validator in `src/common/validators/`):

- lowercase `a–z`, `0–9`, single hyphens, 3–30 chars, no leading/trailing hyphen
- not in the reserved list: `api`, `site`, `site-builder`, `admin`, `auth`,
  `users`, `www`, `assets`, `uploads`, `static`, `health`
- unique across `Store.slug` (case-insensitive)

**Taken** → `409 Conflict`:

```jsonc
{ "message": "This domain is already taken", "suggestions": ["toys-city-eg", "toys-city-store"] }
```

(The plan said `400`; `409` is the correct status for a uniqueness clash and lets
the client tell "malformed" apart from "taken". Two owners racing for the same
slug are caught by the unique index and mapped to the same `409`.)

**Available** → `201`, the `Store` row is created (`status = draft`), draft
`step = domain_confirmed`:

```jsonc
{
  "slug": "toys-city",
  "storeUrl": "https://inventoai.com/toys-city",
  "hint": "\"toys-cities\" already exists on InventoAI. Your customers may confuse the two — a more distinct name is safer, but you can keep this one."
}
```

`hint` is **advisory, never blocking** — the slug is already reserved for the
owner when the hint is returned, and they may ignore it and move on, or call this
endpoint again with a different domain.

Collision detection (`findSimilarSlugs`): build the candidate set from the
requested slug — singular/plural variants (`±s`, `±es`, `y → ies`), the
hyphen-stripped form, and an `ILIKE` prefix match — then keep any existing slug
within a Levenshtein distance of 2. Store counts are small at MVP so this runs
in JS over the matched rows; at scale, move it to Postgres `pg_trgm`
(`similarity() > 0.6` + a GIN index).

Re-calling with a different domain before publish renames the store and frees the
old slug. After publish the slug is frozen (see
[Deferred improvements](#deferred-improvements)).

### Step 4 — generate themes

Generation is slow (Gemini + validation), so it is split from reading:

```
POST /site-builder/themes     # generate — slow, shows the client's loader
GET  /site-builder/themes     # read what was already generated — cheap, resumable
```

`POST` asks Gemini — in a single call — for the **store description** and **4**
themes derived from the questionnaire (brand personality, audience, price range,
preferred color / logo colors). Each theme is validated against the
[Theme contract](#theme-contract); the valid ones are persisted as `StoreTheme`
rows with a new `generation`, and the description is saved on the draft. Invalid
entries are dropped; if fewer than 2 themes survive, retry once, then `503`.
Sets `step = themed`.

The description is paired with the themes because both are written from the same
questionnaire — one call instead of two, at the cost of a regenerated batch also
rewriting the description.

Response (both verbs):

```jsonc
{
  "themes": [
    {
      "id": "8c1f…",
      "name": "Verdant Calm",
      "description": "Natural teal and sage palette. Calming and trustworthy.",
      "style": "maia",
      "font": "sans",
      "radius": "1rem",
      "light": { "background": "oklch(0.975 0.012 160)", "…": "…" },
      "dark":  { "background": "oklch(0.13 0.04 165)",  "…": "…" },
      "css": { "basePreset": "maia", "name": "…", "description": "…", "rawCss": ":root { … } .dark { … }" }
    }
  ]
}
```

Both shapes are returned: `light`/`dark` for a structured preview, `css` for
dropping straight into a `<style>` tag. The frontend picks whichever it needs.

> The original plan had `GET …/get-selected-themes` with a **request** body
> holding the themes — that was a typo; a GET carries no body and the themes are
> the *response*.

### Step 5 — publish

```
POST /site-builder/publish
```

```jsonc
{ "themeId": "8c1f…" }
```

1. `themeId` must belong to the caller's store → otherwise `404`.
2. Requires `step = themed`; anything earlier → `409`.
3. Sets `isSelected` on that theme, clearing the others.
4. **If no logo was uploaded**, generate the monogram fallback now — this is the
   first moment the selected palette is known (see [Monogram logo](#monogram-logo)).
5. `Store.status = live`, draft `step = published`.

```jsonc
{ "slug": "toys-city", "status": "live", "storeUrl": "https://inventoai.com/toys-city" }
```

> The plan used a numeric `themeId: 2` (an array index). Indexes break the moment
> themes are regenerated — the client sends back the row **uuid** instead.

### Step 6 — resolve the store (public)

```
GET /site/:slug
```

What the storefront client calls for `inventoai.com/SITENAME`. Returns `404` for
an unknown slug **and** for a store still in `draft` (an unpublished slug must
not leak).

```jsonc
{
  "name": "Toys City",
  "slug": "toys-city",
  "description": "…",
  "logoUrl": "https://res.cloudinary.com/…/toys-city.png",
  "logoSource": "monogram",
  "locale": "en",
  "hero": {
    "imageUrl": "https://res.cloudinary.com/…/hero.jpg",
    "headline": "Toys that survive real children",
    "subtitle": "Hand-picked wooden and outdoor toys for ages 2–10, delivered across Cairo.",
    "ctaLabel": "Shop now",
    "ctaHref": null
  },
  "theme": {
    "font": "sans",
    "radius": "1rem",
    "light": { "background": "oklch(0.975 0.012 160)", "…": "…" },
    "dark":  { "background": "oklch(0.13 0.04 165)",  "…": "…" },
    "style": "maia"
  }
}
```

`theme` is the **stored `Theme` shape**, not the derived CSS: the storefront
client gets exactly what is in the database and renders it itself. The
`basePreset` / `rawCss` form is still produced by `buildThemeCss`, but only for
the owner-facing theme picker in step 4, where a ready-to-inject `<style>` block
is what the preview needs.

`hero` is the landing page's banner block. Its `headline` and `subtitle` are
drafted by the AI in step 4 (same call as the themes), the image is uploaded from
the dashboard, and `ctaLabel` defaults to "Shop now" at publish. Publishing never
overwrites hero fields the owner has already edited.

> **Still missing from this response: `featuredProducts` and
> `featuredCategories`**, both owner-curated from the dashboard. They need
> `Product` and `Category`, which do not exist yet — deliberately omitted rather
> than stubbed, so the contract never advertises what the backend cannot fill.
> Tracked in [TODO.md](../../TODO.md), with a `TODO(catalog)` marker at the exact
> spot in `StorePublicResponseDto`.

### Managing the hero (dashboard)

```
PATCH /stores/me/hero
Content-Type: multipart/form-data
```

| Field | Rules |
| --- | --- |
| `image` | file, optional, `image/png\|jpeg\|webp`, ≤ 5 MB |
| `headline` | optional, ≤ 80 chars |
| `subtitle` | optional, ≤ 200 chars |
| `ctaLabel` | optional, ≤ 40 chars |
| `ctaHref` | optional, ≤ 2048 chars (a path or a URL) |

`OWNER` only. An omitted field is left alone; an empty one clears it. A new
image replaces the old Cloudinary asset. Responds with the updated `hero` block.

> Admins cannot reach this yet: a `USER`/`ADMIN` account has no link to a store —
> `Store` only knows its `ownerId`. Extending it to store staff needs that
> relation first.

Built with a static `StorePublicResponseDto.fromEntity` factory, per the
project's hand-mapped response convention.

---

## Question catalog

| id | Question | Type | Options |
| --- | --- | --- | --- |
| `q1` | What's your business name? | `text` | — |
| `q2` | What does your business sell? | `text` | — |
| `q3` | Who is your target audience? | `text` | — |
| `q4` | What's your price range? | `multi` | Budget, Mid-range, Premium, Luxury |
| `q5` | How would you describe your brand's personality? | `single` | Energetic, Calm, Elegant, Playful |
| `q6` | What type of products do you sell? | `single` | Physical, Digital, Both |
| `q7` | Your preferred color? | `single` | Blue, Red, …, Let AI choose |

`q7` is conditional: **shown only when the owner uploaded a logo**, hidden
otherwise. Kept as specified — revisit later, see
[Deferred improvements](#deferred-improvements).

Answer wire format:

```ts
type QuestionAnswer =
  | { questionId: string; answer: string | null }     // text
  | { questionId: string; answer: number | null }     // single → option index
  | { questionId: string; answer: number[] | null };  // multi  → option indexes
```

---

## Theme contract

What the AI must emit, and what the database stores:

```ts
export type SpartanPreset = 'nova' | 'vega' | 'lyra' | 'maia' | 'mira' | 'luma';
export type ThemeFont = 'sans' | 'serif' | 'mono';

export interface Theme {
  name: string;          // "Verdant Calm"
  description: string;   // one line, shown in the picker
  style: SpartanPreset;  // base preset
  font: ThemeFont;
  radius: string;        // CSS length: /^\d+(\.\d+)?(rem|px)$/
  light: Palette;
  dark: Palette;
}

export interface Palette {
  background: string;         foreground: string;
  card: string;               cardForeground: string;
  popover: string;            popoverForeground: string;
  primary: string;            primaryForeground: string;
  secondary: string;          secondaryForeground: string;
  muted: string;              mutedForeground: string;
  accent: string;             accentForeground: string;
  destructive: string;
  border: string;             input: string;              ring: string;
  chart1: string;             chart2: string;             chart3: string;
  chart4: string;             chart5: string;
}
```

Changes from the first draft of this interface, all forced by the target CSS:

- Added `name` + `description` — the output format carries them and nothing else
  produces them.
- Added `popover` / `popoverForeground` — `--popover*` appears in the CSS.
- Added `chart1…chart5` — the admin dashboard's charts need brand-consistent
  series colors, and generating them with the palette beats bolting them on
  later. They live on `Palette` (not on `Theme`) because they differ per scheme.
- The `--sidebar-*` block is **derived**, not asked for (see below): it is admin
  chrome, irrelevant to a storefront palette, and asking the AI for 8 more
  correlated colors is a reliability tax.

Every colour value must be an `oklch(...)` string. Validate with a custom
`@IsOklchColor()` validator (`src/common/validators/`) applied to every `Palette`
field via a nested DTO, so a hallucinated `#3b82f6` or `red` is rejected before
it reaches Postgres. `style` is validated against `SpartanPreset`; `font` and
`radius` against their own rules.

Gemini is called with a **response schema** (structured output) matching this
interface, so the parse is a formality rather than the defence.

### Conversion helper

`buildThemeCss(theme: Theme): ThemeCssDto` in
`src/site-builder/utils/theme-css.util.ts` — pure, no I/O, unit-testable:

```ts
{
  basePreset: theme.style,
  name: theme.name,
  description: theme.description,
  rawCss: ':root { … }\n.dark { … }'
}
```

Rules:

1. Every `Palette` key becomes `--` + kebab-case (`cardForeground` →
   `--card-foreground`, `chart1` → `--chart-1`).
2. `light` → `:root { … }`, `dark` → `.dark { … }`.
3. `--radius` and the font tokens are emitted in `:root` **only** — neither is
   scheme-dependent.
4. Font tokens: all three stacks are emitted as constants, and `--font-body`
   points at the one the theme chose, so the Angular app needs no extra field:

   ```css
   --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
   --font-serif: ui-serif, Georgia, Cambria, "Times New Roman", serif;
   --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
   --font-body: var(--font-serif);   /* ← theme.font */
   ```

5. Derived tokens, appended to each block:

   | Token | Derived from |
   | --- | --- |
   | `--sidebar` | `card` |
   | `--sidebar-foreground` | `foreground` |
   | `--sidebar-primary` | `primary` |
   | `--sidebar-primary-foreground` | `primaryForeground` |
   | `--sidebar-accent` | `accent` |
   | `--sidebar-accent-foreground` | `accentForeground` |
   | `--sidebar-border` | `border` |
   | `--sidebar-ring` | `ring` |

---

## Monogram logo

When the owner uploads nothing, publish generates a logo instead of blocking:

1. Derive initials from `businessName` — first letter of each of the first two
   words, uppercased; a single-word name uses its first two letters. Works for
   Arabic names unchanged (no `toUpperCase` effect, correct letters).
2. Render a 512×512 SVG server-side (a string template, no image library): a
   rounded square filled with the selected theme's **light** `primary`, initials
   centred in `primaryForeground`, using the theme's font stack and `radius`.
3. Upload the SVG to Cloudinary, store `logoUrl` + `logoPublicId`, and set
   `logoSource = 'monogram'`.

Because it is regenerated from the store name + selected palette, an owner who
later changes their theme can have the monogram refreshed; an owner who uploads a
real logo overwrites it (`logoSource = 'uploaded'`).

---

## Deferred improvements

Not in scope now — recorded so they aren't lost.

- **Revisit `q7`'s condition.** As specified, "preferred color" is shown only
  when a logo *was* uploaded and hidden when it wasn't. The intuitive rule is the
  opposite: with a logo you can sample its palette, without one you have nothing
  to go on and need the owner to say. Worth re-testing with real owners; the
  change is one flag on the catalog constant plus the prompt branch.
- **Slug renaming with redirects.** The slug is permanent today. Allowing a
  rename means keeping the old slug as an alias row (`StoreSlugAlias`) and
  answering `GET /site/:oldSlug` with a `301` to the current one, so shared links
  and search rankings survive.
- **Partial regeneration.** The overview promises "regenerating only the
  requested part" — an owner saying "same theme but warmer" or "new logo only"
  and getting that one piece redone, instead of four brand-new themes. Needs a
  revise endpoint that takes a theme id + a free-text instruction, and versioning
  so the previous value can be restored.
- **Arabic typography.** The font stacks above have no Arabic-first family; a
  store with `locale = 'ar'` should get something like Cairo or Tajawal in
  `--font-body`.
- **Regenerate the monogram on demand** after a theme change (today it is
  produced once, at publish).
- **Sample the palette from the uploaded logo.** Themes are generated from the
  questionnaire only; feeding the logo's bytes to Gemini would let it match the
  brand's actual colours instead of the owner's stated preference.

---

## Implementation notes

Where the built code makes a call this spec left open:

- **Re-running the brainstorm without a file keeps the existing logo.** The spec
  says the endpoint "replaces the brainstorm, logo and answers"; clearing the
  logo whenever the file field is absent would destroy an asset the owner never
  asked to remove, and would silently hide `q7`. A new file replaces (and deletes
  the old Cloudinary asset); no file leaves the logo alone.
- **A reserved slug is a `400`, not a `409`.** `409` means "someone has it";
  `api` or `admin` is a malformed choice nobody can ever have.
- **Status codes:** brainstorm `200`, answers `200`, domain `201` (a store row is
  created), themes `201`, publish `200`.
- **`GET /site-builder/questions` always returns the whole catalog**, `showWhen`
  included. The client decides whether to render `q7`; the server enforces it on
  submit, rejecting a `q7` answer from an owner with no logo.
- **The monogram is uploaded as SVG and delivered as PNG** (`cloudinary.url(id,
  { format: 'png' })`), because SVG delivery is restricted on some Cloudinary
  accounts. Its colours are converted from `oklch()` to hex first — the
  rasterizer does not understand `oklch()`.
- **The store description rides along with the themes call** (step 4) and is
  written to the `Store` row at publish. Nothing reads the store before it is
  live, so there is no reason to sync branding earlier. If the model returns an
  empty description the previous one is kept.
- **Themes are validated one by one**, and a batch is retried once if fewer than
  `MIN_VALID_THEMES` survive. The stored palette is rebuilt from `PALETTE_KEYS`,
  so no stray AI field reaches the jsonb column.
- **Logo colour sampling is not implemented.** Step 4 mentions deriving themes
  from "preferred colour / logo colours"; the prompt gets the owner's `q7`
  colour and whether a logo exists, but never the image bytes. `q7` is only shown
  when a logo was uploaded, so the signal is there either way — see
  [Deferred improvements](#deferred-improvements).

## Implementation order

1. `RolesGuard` + `@Roles()` (blocking dependency).
2. Env vars (Gemini + Cloudinary) on `EnvironmentVariables` and `.env.example`.
3. Entities `Store`, `StoreTheme`, `SiteBuildDraft` + module skeleton.
4. Question catalog constant, DTOs, `@IsSlug` / `@IsOklchColor` validators.
5. `buildThemeCss` + `findSimilarSlugs` + the monogram SVG builder, with unit
   tests — all pure, cheapest to get right first.
6. `GeminiService` in `src/ai/` (global, like `MailModule`) with the two prompts
   and their structured-output schemas.
7. `CloudinaryService` in `src/storage/` (global) — upload, destroy.
8. Endpoints in flow order, verified with the REST client per
   [ai-interactions.md](../ai-interactions.md).
