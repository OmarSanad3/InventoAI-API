# Granting permissions in plain language

> An add-on to [admin-accounts-rbac.md](./admin-accounts-rbac.md), and
> meaningless without it. The owner types *"let Sara read the FAQ but not edit
> it"* and gets a **proposal** they can see, edit and apply.
>
> No new entity, no new env var, no new dependency, and — the rule the whole
> spec turns on — **no new writer of `User.permissions`**.

## Overview

The RBAC feature gives an owner fourteen checkboxes. That is the correct data
model and a poor interface for a non-technical shop owner in Cairo who thinks
in jobs, not in `catalog:write` — and who is as likely to type the sentence in
Arabic as in English.

So: one text field. The owner writes what they want, the platform turns it into
a **diff against the admin's current permissions**, shows it, and applies it
only when the owner presses the button they were going to press anyway.

```
  "خليها تشوف الأسئلة الشائعة بس من غير تعديل"
                │
                ▼
   ┌──────────────────────────────────────────────┐
   │ deterministic matcher   → faq:read           │  always runs
   │ Gemini (only if needed) → faq:read           │  closed vocabulary
   └──────────────────────────────────────────────┘
                │
                ▼
   proposal:  + faq:read        (grant)
              − faq:write       (revoke — "not edit")
              = orders:read     (unchanged)
              ? "the money stuff"  ← unmatched, shown verbatim
                │
        owner reviews, edits, presses Save
                ▼
        PATCH /admins/:id  { permissions: [...] }   ← the existing route
```

## Goals

- An owner expresses a grant or a revocation in a sentence, in English or
  Arabic, and gets the exact permission set it means.
- The proposal is a **diff**, not a replacement: what changes, what does not,
  and what the platform did not understand.
- Nothing is written until the owner applies it, through the route that already
  writes permissions.
- With Gemini down, the common phrasings still work.

## Non-goals

- **Creating, deleting or deactivating an admin by sentence.** Only the
  permission set. "Fire Ahmed" is a button, and it is deliberately not something
  a model can produce.
- **A chat.** One field, one proposal. No history, no follow-ups, no agent, no
  tools.
- **Inventing permissions.** The catalogue is a closed enum. A sentence that
  asks for something outside it comes back as `unmatched`, never as an
  approximation.
- **Applying anything.** See decision 1.

## Decisions

### 1. The model proposes; `PATCH /admins/:id` disposes

This is the same shape as the AI catalog setup
([catalog-ai-setup.md](./catalog-ai-setup.md)): `generate` persists nothing,
`apply` re-validates from scratch. Here it is stricter still — there is no new
apply route at all. The proposal endpoint returns a permission array, and the
owner's dashboard sends it to the **existing** `PATCH /admins/:id`.

Which means the rule from the RBAC spec — *"`PATCH` replaces the set; the owner
sees exactly what they will get"* — still holds, and `AdminService` remains the
single writer of `User.permissions`. A model that could write directly would be
a second path to privilege, reachable by a sentence.

### 2. Deterministic first, model second

A keyword matcher runs **always** and resolves the common cases with no API
call: the fourteen permission keys, their labels, their module names, and the
obvious verbs (`read/view/see/اقرأ/يشوف`, `edit/manage/change/يعدل/يدير`) plus
the negations (`not`, `only`, `except`, `بدون`, `بس`, `ماعدا`).

Gemini is called **only when the matcher leaves something unresolved** —
unusual phrasing, mixed languages, or a job description rather than a module
name ("let him run the shop while I'm away"). Three reasons, and the third is
the real one:

- it is free and instant for the 80% case;
- the free Gemini tier is already the binding constraint on this project;
- **the feature still works when Gemini does not.** A permission editor that
  fails closed because a model is rate-limited is worse than checkboxes.

This is the same two-phase arrangement `summarizeUnanswered` (always) and
`ChatClusteringService` (semantic, best-effort) already make.

### 3. The model's vocabulary is the enum, and nothing else

The schema offers no free-text permission field:

```ts
{
  grant:  { type: ARRAY, items: { type: STRING, enum: [...AdminPermission] } },
  revoke: { type: ARRAY, items: { type: STRING, enum: [...AdminPermission] } },
  unmatched: { type: ARRAY, items: { type: STRING } },
  summary: { type: STRING }   // one sentence, for the owner to read
}
```

and `sanitizePermissionProposal` drops anything that is not a member of the enum
anyway, because a schema is a constraint on a cooperative model and not a
defence. `summary` is prose and is displayed as prose; it is never parsed.

**There is no `admins:*` permission to hallucinate**, which is the RBAC spec's
decision 2 paying for itself here: the worst a compromised prompt can propose is
a set the owner is looking at.

### 4. Three normalisation rules, and they are the tested part

Applied after sanitising, in this order:

1. **Revoke wins a conflict.** A sentence that both grants and revokes the same
   permission is ambiguous; the safe reading is less access.
2. **Revoking a read revokes its write.** `catalog:read` off while
   `catalog:write` stays on is a state the guard would honour (write implies
   read) and the owner did not mean. Removing the read removes the pair.
3. **Granting a write grants its read**, for the mirror reason — it is what
   `PERMISSION_IMPLICATIONS` already says, made explicit in the proposal so the
   owner sees the whole consequence before applying.

These live in `normalizePermissionDiff`, a pure function, with the unit tests
that make them trustworthy. **They are applied to the deterministic path and the
model path alike** — the model does not get its own rules.

### 5. Sensitive permissions are flagged, never auto-applied quietly

`suppliers:write` spends money and `storefront:write` changes what every visitor
sees. If either appears in the `grant` list, the response marks
`requiresConfirmation: true` and names them, so the dashboard can ask a second
time. The API does not refuse them — the owner may well mean it — it refuses to
let them slide past in a sentence.

## Auth & access control

| Surface | Rule |
| --- | --- |
| `POST /admins/:id/permissions/interpret` | `JwtAuthGuard` + `RolesGuard`, `@Roles(OWNER)` |

Owner-only, like every `/admins` route, and for the same reason: an admin who
could ask this question could ask it about themselves.

## Endpoint — `src/users/admins.controller.ts`

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/admins/:id/permissions/interpret` | `InterpretPermissionsDto` | `PermissionProposalDto` (200) |

200, not 201: nothing is created. A Redis cooldown of
`PERMISSION_INTERPRET_COOLDOWN_SECONDS` (10) per owner keeps a held-down key
from spending the day's Gemini quota; the 429 names the seconds left, as
`POST /catalog/generate` does. **The cooldown is cleared when the call fails**,
the same fix branch 4 made.

```jsonc
// response
{
  "current":   ["orders:read", "orders:write", "faq:write"],
  "proposed":  ["orders:read", "orders:write", "faq:read"],
  "granted":   ["faq:read"],
  "revoked":   ["faq:write"],
  "unchanged": ["orders:read", "orders:write"],
  "unmatched": ["the money stuff"],
  "requiresConfirmation": false,
  "sensitiveGranted": [],
  "summary": "Sara can read the FAQ but no longer edit it.",
  "source": "rules" | "ai" | "hybrid"
}
```

`source` is the honest record of who resolved it — the same instinct as
`draftStatus` and `narratorStatus`. `proposed` is what the dashboard sends
verbatim to `PATCH /admins/:id`.

## DTOs — `src/users/dto/`

| File | Shape |
| --- | --- |
| `interpret-permissions.dto.ts` | `instruction` (`@IsString() @Length(3, 500)`) |
| `permission-proposal.dto.ts` | the shape above |

No `permissions` field on the request: the current set comes from the row, so a
stale dashboard tab cannot smuggle in a set the owner never saw.

## Prompt — `src/users/prompts/interpret-permissions.prompt.ts`

Given: the catalogue (key, label, module, whether it is sensitive), the admin's
**current** permissions, and the owner's sentence. Asked for the four fields
above.

Rules in the prompt, all absolute: use only the given keys; never invent one;
put anything you cannot map into `unmatched` **verbatim**; when the sentence
says "only", everything else in that module is revoked; when it is ambiguous,
prefer the smaller grant; write `summary` in the language of the instruction.

The owner's sentence is the only untrusted text here, and it is text the owner
typed about their own store — the injection surface is a person attacking
themselves. The defence that matters is structural anyway: a closed enum, a
diff the owner reads, and a separate apply.

## Constants — `src/users/users.constants.ts`

```ts
export const PERMISSION_INSTRUCTION_MAX_LENGTH = 500;
export const PERMISSION_INTERPRET_COOLDOWN_SECONDS = 10;
export const PERMISSION_INTERPRET_TEMPERATURE = 0.1;   // reading, not writing
/** Phrase → permission, for the deterministic pass. Bilingual on purpose. */
export const PERMISSION_PHRASES: Readonly<Record<string, AdminPermission[]>>;
```

No new env var — `GEMINI_MODEL`, like the supplier draft. An owner edits
permissions a handful of times in a store's life.

## Implementation order

1. `matchPermissionPhrases` and `normalizePermissionDiff` — pure, **with their
   tests**. At this point the feature works with no AI at all.
2. `sanitizePermissionProposal` — drops non-enum values, de-duplicates, applies
   the normalisation. Tested against a deliberately hostile model response.
3. The prompt, schema, and `PermissionInterpreterService` (deterministic first,
   Gemini for the remainder, `source` recorded).
4. The DTOs and the route, with the Redis cooldown.

## Tests

Unit:

- `matchPermissionPhrases` — "read the FAQ" → `faq:read`; "manage products" →
  `catalog:write` (+ read by implication); "only read" scopes the module;
  "not edit"/"بدون تعديل" produces a revoke; an unknown phrase is returned
  unmatched rather than guessed.
- `normalizePermissionDiff` — grant+revoke of the same key resolves to revoke;
  revoking `catalog:read` also revokes `catalog:write`; granting
  `orders:write` also grants `orders:read`; a diff that changes nothing reports
  empty `granted`/`revoked` and a full `unchanged`.
- `sanitizePermissionProposal` — `"admins:write"`, `"*"`, `"DROP TABLE"` and a
  number are all dropped; duplicates collapse; a response missing every field
  yields an empty, valid proposal rather than a throw.

Endpoint:

- *"let her read the FAQ but not edit it"* on an admin holding `faq:write` →
  `granted: [faq:read]`, `revoked: [faq:write]`, and **the row is unchanged**
  until `PATCH` is called.
- The Arabic phrasing of the same sentence produces the same `proposed` set.
- *"give her everything"* → every non-sensitive permission plus
  `requiresConfirmation: true` naming `suppliers:write` and
  `storefront:write`.
- *"make her an owner"* / *"let her create admins"* → no permission granted,
  the phrase comes back in `unmatched`.
- With the Gemini key broken: *"read the FAQ"* still resolves,
  `source: "rules"`; a florid sentence returns everything unmatched and a 200,
  **never a 500**.
- Two calls inside the cooldown → 429 naming the seconds; a failed call does not
  start one.
- An `ADMIN` calling it → 403. Another store's admin id → 404.
- A 501-character instruction → 400; an empty one → 400.
- The proposal fed straight into `PATCH /admins/:id` applies exactly, and a
  second interpret of the same sentence then reports everything `unchanged`.

## Considered and rejected

- **Letting the model write the permissions directly.** A second writer of
  privilege, reachable by a sentence. The whole feature is a proposal generator
  on purpose.
- **A chat interface.** Multi-turn state, an agent, tools, and a much larger
  surface, to set a field the owner can also set with checkboxes.
- **Skipping the deterministic pass and always calling Gemini.** Slower, quota-
  bound, and it makes a permission editor depend on a third party being up.
- **Free-text permissions** ("can_edit_faq_but_not_delete"). The enum is the
  contract the guard enforces; anything else is a string that means nothing at
  request time.
- **Letting the sentence create or remove admins.** The blast radius of a
  misread verb is an account, and the model's read of "remove" is not something
  to find out about afterwards.
- **Storing the instruction history.** It is an audit-log feature, and the RBAC
  spec already defers a real one — a half-log of only the AI-driven changes
  would be the worst of both.

## Deferred

- **The same field for creating an admin** ("add sara@… to the order desk"),
  once an audit log exists to record what it did.
- **Named roles by sentence** — "make a Warehouse role and put these three in
  it" — which needs the `permission_sets` table the RBAC spec defers.
- **An explanation endpoint**: *"why can't Sara edit products?"*, answered from
  the same catalogue.
- **Recording the instruction alongside the change** in the audit log, so a
  permission set can be traced back to the sentence that produced it.
