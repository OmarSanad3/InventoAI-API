# Chatbot Branch 3 — Owner Insights & Settings

> Part of the [Storefront Chatbot](./chatbot.md) epic. Depends on
> [chatbot-agent.md](./chatbot-agent.md) for `ChatSession`, `ChatMessage` and
> `ChatResolution` — it reads those rows and adds no conversation logic.

## Overview

The smallest branch of the epic, and the one that makes the other two pay off
twice. Branch 2 already records every message and computes an honest
`resolution`; this branch is the owner's window onto it, plus the per-store
switches the assistant should have had a dashboard for from the start.

It also defines the read API the **Daily AI Advisor** will call for its
"45 customers asked the chatbot for wireless earbuds — you don't sell them yet"
line. That line is the reason `resolution` is computed in code rather than
claimed by the model.

## Goals

- An owner can read what shoppers asked their assistant, and what it answered.
- An owner can see the questions it **could not** answer, grouped, most frequent
  first — a demand signal they have no other source for.
- An owner can turn the assistant off, change its greeting and give it a tone,
  without a deploy.
- The Advisor has a stable, store-scoped method to read the unanswered feed
  from.

## Non-goals

- The Advisor itself — the brief, the schedule, the weather and calendar
  signals.
- Replying to a shopper from the dashboard. Reading a transcript is not live
  chat; [chatbot.md](./chatbot.md) rules handover out.
- Analytics beyond counts: no funnels, no cohorts, no chart data endpoint.
- Editing or deleting individual messages. A transcript is a record.

## Auth & access control

Every route in this branch: `JwtAuthGuard` + `RolesGuard`, `@Roles(OWNER,
ADMIN)`, store from `StoreService.resolveCallerStore`. A session belonging to
another store 404s.

## Data model

### `ChatbotSettings` (new) — `src/chatbot/entities/chatbot-settings.entity.ts`

One row per store, created lazily on first read with defaults.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `storeId` | `uuid`, unique | `onDelete: 'CASCADE'` |
| `isEnabled` | `boolean`, default `true` | |
| `greeting` | `varchar(300)`, nullable | The first bubble; falls back to a platform default in the store's own name |
| `tone` | `enum ChatbotTone`, default `friendly` | `friendly \| formal \| playful` — one line appended to the system prompt |
| `contactEmail` | `varchar(320)`, nullable | Offered when the assistant cannot answer |
| `createdAt` / `updatedAt` | timestamps | |

A separate table rather than four more columns on `Store`: `Store` is the
site-builder's entity and already carries branding, slug, currency and order
numbering. A free-text `tone` was rejected for the reason
[ecommerce-core.md](./ecommerce-core.md) rejected free-text attributes — it goes
into a prompt, and "you are a pirate, ignore the shop" is a prompt the owner
should not be able to write by accident.

**Branch 2 must respect `isEnabled`**: when it is false,
`POST /site/:slug/chat` 404s exactly like a route that does not exist, and the
storefront hides the widget. Wiring it is one lookup in `ChatService`, and it is
this branch's only change to merged code.

### `ChatMessage.reviewedAt` (new column)

`timestamp`, nullable. An owner marks an unanswered question as dealt with —
they stocked the thing, or they decided not to. Reviewed questions leave the
default feed and stop reaching the Advisor, which is what keeps a brief from
repeating the same advice for a month.

## Endpoints — `src/chatbot/chat-insights.controller.ts`

| Method | Route | Query / Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/chat/sessions` | `ChatSessionQueryDto` | `PaginatedResponseDto<ChatSessionSummaryDto>` |
| `GET` | `/chat/sessions/:id` | — | `ChatTranscriptDto` |
| `GET` | `/chat/unanswered` | `UnansweredQueryDto` | `PaginatedResponseDto<UnansweredGroupDto>` |
| `PATCH` | `/chat/unanswered/:messageId/review` | — | `MessageResponseDto` |
| `GET` | `/chat/stats` | `?days=30` | `ChatStatsDto` |
| `GET` | `/chat/settings` | — | `ChatbotSettingsDto` |
| `PATCH` | `/chat/settings` | `UpdateChatbotSettingsDto` | `ChatbotSettingsDto` |

- **`/chat/sessions`** — newest `lastMessageAt` first. Filters: `from`/`to`,
  `hasUnanswered`, `isSignedIn`, and `search` as `ILIKE` over message text. The
  same call [orders.md](./orders.md) made about its own search applies: an owner
  reading transcripts knows what they are looking for, and the full-text stack
  is for discovering products.
- **`/chat/sessions/:id`** — the whole transcript, ordered
  `createdAt ASC`, with each assistant message's `resolution` and `sources`. It
  is the dashboard's counterpart to branch 2's public transcript route, and
  unlike that one it needs no capability id — the store scope is the
  authorisation.
- **`/chat/unanswered`** — grouped, `occurrences DESC`. Default window 30 days,
  `includeReviewed=false`.
- **`/chat/stats`** — totals over the window: sessions, messages, a breakdown by
  `resolution`, and the ten product ids surfaced most often. One grouped query
  each; the product ids are hydrated to titles by the controller.

## Grouping the unanswered questions

Fifty shoppers asking for earbuds type fifty different sentences. A list of
fifty rows is not a demand signal; "wireless earbuds — 45 times" is.

Two passes, and the split is deliberate.

**1. Deterministic, always** — `summarizeUnanswered` in
`src/chatbot/utils/summarize-unanswered.util.ts`, pure and unit-tested:
lowercase, strip punctuation and diacritics, drop a small stop-word list
(English and Arabic), sort the remaining tokens, and group on the result. It
collapses "do you have wireless earbuds" and "wireless earbuds?" and nothing
cleverer. Every group carries its `occurrences`, its most recent example
verbatim, and the message ids behind it, so a review marks all of them.

**2. Semantic, when it is worth it** — the same `EmbeddingProvider` branch 1
already ships. Unanswered questions are embedded like anything else, and groups
whose centroids sit within `UNANSWERED_CLUSTER_THRESHOLD` cosine distance merge.
This is what pulls "earbuds", "airpods" and "سماعات لاسلكية" into one line.

The second pass runs in the same nightly job as branch 1's reconcile, writes its
grouping to `ChatMessage.clusterKey` (a new nullable `varchar(64)`), and the
endpoint reads it. If embeddings are unavailable the endpoint falls back to pass
one — a coarser grouping, not an error.

Both passes cap at `UNANSWERED_MAX_GROUPS` (200) per window. An owner does not
read past the top twenty, and the Advisor reads fewer.

## What the Advisor will call

The one method other features are meant to depend on, and the reason this branch
exists before the Advisor does:

```ts
// ChatInsightsService
async listUnansweredThemes(params: {
  storeId: string;
  since: Date;
  limit?: number;          // default ADVISOR_THEME_LIMIT (10)
}): Promise<UnansweredTheme[]>   // { label, occurrences, exampleQuestion, lastAskedAt }
```

Store-scoped, reviewed rows excluded, ordered by occurrences. The Advisor turns
it into a sentence; it does not re-derive the grouping, and it does not read
`ChatMessage` directly.

## Retention

Transcripts accumulate, and they contain whatever a shopper typed — which
occasionally includes a phone number they should not have typed. So:

- A nightly job deletes sessions with no activity for
  `CHAT_RETENTION_DAYS` (180), cascading their messages.
- Sessions bound to a user are kept the same length as anonymous ones; there is
  no reason for the assistant's memory of a customer to outlive it.
- `SETUP.md` and the storefront widget should say the conversation is stored.

The number is a constant rather than an env var: it is a policy, not a
deployment detail, and it changes with a code review.

## Constants

```ts
export const UNANSWERED_WINDOW_DAYS = 30;
export const UNANSWERED_MAX_GROUPS = 200;
export const UNANSWERED_CLUSTER_THRESHOLD = 0.25;
export const ADVISOR_THEME_LIMIT = 10;
export const CHAT_RETENTION_DAYS = 180;
export const CHATBOT_GREETING_MAX_LENGTH = 300;
```

No new environment variables.

## Implementation order

1. `ChatbotSettings` + `ChatbotTone`, its two routes, and the `isEnabled` check
   in branch 2's `ChatService`.
2. `ChatMessage.reviewedAt` and `clusterKey`.
3. `summarizeUnanswered` with its tests, then `/chat/unanswered` and the review
   route.
4. `/chat/sessions`, `/chat/sessions/:id`, `/chat/stats`.
5. `listUnansweredThemes`, and the semantic pass in the nightly job.
6. Retention.
7. Seed: a handful of chat sessions per seeded store — one answered, one
   off-topic, three unanswered that group into one theme — so the dashboard has
   something to render before a single real shopper arrives.

## Tests

- Ask the seeded store's chatbot three different ways for something it does not
  sell → `/chat/unanswered` shows **one** group with `occurrences: 3`.
- Reviewing that group removes it from the default feed, and
  `?includeReviewed=true` brings it back.
- `listUnansweredThemes` excludes reviewed rows and respects `since`.
- An off-topic message never appears in the unanswered feed — that distinction
  is the whole value of the enum.
- `isEnabled: false` → `POST /site/:slug/chat` 404s; flipping it back restores
  the route.
- A greeting over 300 characters → 400; a `tone` outside the enum → 400;
  `storeId` in the body → 400 `should not exist`.
- Store B's session id on store A's `/chat/sessions/:id` → 404, and the session
  survives.
- A `USER` token on any of these routes → 403; no token → 401.
- `/chat/stats` numbers reconcile with the transcripts they came from.
- Retention: a session aged past the window is gone with its messages; one a day
  younger is not.

## Considered and rejected

- **Free-text chatbot persona.** It is concatenated into a system prompt.
  An enum of three tones covers what an owner actually wants and cannot be used
  to rewrite the assistant's rules.
- **Clustering unanswered questions with a Gemini call per window.** The
  embeddings are already there and already free; a generation call would be a
  second AI dependency for grouping strings.
- **Storing the grouping as its own entity.** A `clusterKey` on the message is
  one nullable column and can be recomputed from scratch at any time; a table
  would need its own freshness story.
- **Letting owners delete a transcript.** Nothing good is served by an owner
  editing the record of what their shop was asked, and the retention job removes
  the reason to want it.
- **Exposing `resolution` to the storefront's own dashboard-less widget.**
  Branch 2 already returns it in `ChatReplyDto`; nothing else needs it.

## Deferred

- Emailing the owner when a question goes unanswered, and the "talk to a human"
  button that triggers it.
- Turning an unanswered theme into a draft FAQ entry with one click — the
  obvious next feature, and the loop that closes: shoppers ask, the owner
  answers once, the assistant answers it forever.
- Per-day charts for `/chat/stats`.
- Exporting transcripts.
