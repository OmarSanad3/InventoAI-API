# Ideas — making the system genuinely agentic

> **Status: suggestions only.** Nothing here is specified, scheduled or agreed.
> It exists because the grad-project form asks *"Does your system decide its own
> next steps and call tools without a human choosing which?"* and today the
> honest answer is **No** — every AI call is at a point we chose, does one job,
> and returns. This file lists what would have to change for the answer to be
> **Yes**, and what each option costs. Pick from it later, or don't.

---

## What the question is actually testing

The form warns: *"There is a penalty for answering Yes and then not being able
to describe the loop."* So a Yes has to survive three follow-up questions:

1. **What tools does it choose between?** There must be more than one, and the
   model must pick — not a `switch` we wrote.
2. **What does it do with the result?** It has to feed back in. One call that
   fetches something and then answers is a pipeline, not a loop.
3. **When does it stop?** A real agent needs a termination condition and a step
   cap, or it runs forever and costs money.

A classifier that routes to one of three fixed paths fails test 1 and 2. That is
exactly the shape of the multi-RAG chatbot as currently specified, which is why
it does not count on its own.

---

## The ideas, ranked

| # | Idea | Effort | Strength of the Yes | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Restock & sourcing agent | Medium | Strongest — real tools, real consequences | **Recommended** |
| 2 | Chatbot as a tool-calling agent | Small | Solid, and it is on the roadmap anyway | **Recommended** |
| 3 | Advisor as an investigating agent | Medium | Good | Maybe |
| 4 | Site-builder critique/revise loop | Small | Weak — it is one model talking to itself | Cheap add-on |
| 5 | Supplier negotiation agent | Large | Very strong, high risk | Probably not for MVP |
| 6 | Catalog-setup agent that inspects the store | Small | Weak-to-medium | Nice, not the answer |

The pair to build is **1 + 2**. Together they cover both flavours of agency —
one acts on the world without a human in the loop, one reasons across several
retrieval steps inside a single reply — and neither invents new scope. Both are
already on the roadmap; they just get restructured as loops instead of
pipelines.

---

## 1. Restock & sourcing agent — *the strongest answer*

**What exists in the plan today:** the Advisor computes a reorder suggestion and
prints it in the brief. A human reads it and acts. Section 9 of the overview
("From Low Stock to Deal Closed") then has the AI draft supplier emails — but
only once a person decides to source that product.

**What makes it an agent:** delete the person from the middle. A scheduled run
hands the model a store and a goal — *"keep every product in stock without
overbuying"* — and it works out the rest.

### The loop

It runs with a tool belt and decides which to call, in what order, and how many
times:

| Tool | What it does |
| --- | --- |
| `getLowStockProducts()` | Products under their reorder point |
| `getSalesVelocity(productId, days)` | Units/day over a window the agent picks |
| `getUpcomingEvents(days)` | Ramadan, Eid, back-to-school, matches |
| `getWeatherForecast(days)` | Regional forecast |
| `getSuppliersForProduct(productId)` | Suppliers, lead times, owner notes |
| `getPastOffers(productId)` | What this was last bought for |
| `sendPurchaseRequest({ supplierId, productId, quantity })` | **Writes.** Sends a real email |
| `flagForOwner({ productId, reason })` | Escapes to the human |

A run looks like: find the low-stock list → for each candidate, pull velocity
→ notice one is spiking → check whether an event explains it → decide the
30-day forecast is 3× the normal → pull suppliers → see the cheapest has a
10-day lead time and an owner note saying *"they deliver late"* → decide to
split the order → send two purchase requests → stop.

Nothing in that sequence is written by us. Which product it investigates, how
far back it looks, whether it bothers checking weather for a product that is
obviously seasonal — the model decides. **That is the sentence to put in the
project document.**

### Stop conditions and guardrails

This is the part that makes it defensible rather than reckless:

- **Step cap** — a hard maximum of tool calls per run (say 40). Hitting it ends
  the run and files a `flagForOwner`.
- **Spend cap** — the agent may commit at most *N* currency units per run and
  per product, from a per-store setting. Over that, it must `flagForOwner`
  instead of sending.
- **Write tools are narrow.** It can send a purchase *request* — an email asking
  for a quote. It cannot confirm a deal, spend money, or change stock. The owner
  still picks the winning offer, which keeps the existing state machine
  (`drafted → sent → replied → ranked → confirmed / cancelled`) intact.
- **Every step is logged** — an `AgentRun` row with the tool calls, arguments,
  results and the model's stated reason, rendered in the dashboard. You need
  this anyway to answer *"why did it email that supplier?"*, and it is the
  screenshot that proves the loop exists.
- **Kill switch** — a per-store `autoSourcingEnabled` flag, default **off**.

### What it needs first

Products and variants (branch 3), suppliers, and the inventory event log. So it
lands after the current epic, not during it.

---

## 2. Chatbot as a tool-calling agent — *the cheap one*

**What is specified today:** classify the message into product / order / FAQ /
off-topic, then run the matching retrieval, then answer. One decision, one
fetch, one reply.

**What makes it an agent:** drop the classifier. Give the model the tools and
let it call as many as it needs, in any order, before replying.

| Tool | What it does |
| --- | --- |
| `searchProducts(query, filters)` | The Postgres full-text search from branch 3 |
| `getProductDetails(productId)` | Variants, stock, attributes |
| `checkStock(variantId)` | Live availability |
| `getOrderStatus(orderNumber)` | Only for the authenticated customer |
| `searchFaq(query)` | The store's policy text |
| `logUnansweredQuestion(text)` | Feeds the Advisor's demand mining |

Why this is a real loop, in one example. Customer: *"do you have that blue
lantern I bought last Ramadan, in a bigger size?"*

1. `getOrderHistory()` — find what they actually bought.
2. `getProductDetails(...)` on that lantern — learn it is the "Fanous Classic",
   size M, colour blue.
3. `searchProducts("fanous classic", { color: blue })` — find siblings.
4. `checkStock(...)` on the L variant — out of stock.
5. `searchProducts("fanous", { color: blue, size: L })` — find a near
   alternative from another line.
6. Answer with both facts: the exact one is out, here is the close match.

Six tool calls, chosen by the model, each informed by the last. No classifier
could have planned that in advance — step 3's query is built from step 2's
result. Same stop conditions as above: step cap, then a graceful *"let me get a
human"*.

**Cost:** low. The tools are functions the storefront API already exposes. This
is mostly prompt and loop plumbing, and it makes the chatbot better regardless
of the form question.

**Guardrail that matters:** every tool must take the store scope from the
session, never from the model's arguments. Otherwise a prompted customer reads
another store's orders. `getOrderStatus` must be bound to the authenticated
user's own orders for the same reason.

---

## 3. Advisor as an investigating agent

Instead of us fetching five signals and asking for a summary, hand the Advisor
the same tool belt as idea 1 (read-only) and a goal: *"tell the owner the three
things that matter most tomorrow."* It decides what to look at. If sales are
flat and nothing is upcoming, it spends its budget on the unanswered-question
log instead of pulling weather it does not need.

**Upside:** the brief stops being the same five bullet points every day.
**Downside:** less predictable output, and it overlaps heavily with idea 1 — if
you build 1, this is mostly the same machinery with the write tools removed. Do
it as a *mode* of the same agent rather than a second system.

---

## 4. Site-builder critique/revise loop

After Gemini returns a theme, a second pass scores it against rules we care
about — WCAG contrast on every text/background pair, palette not muddy, font
pairing sane, description free of placeholder text — and if it fails, feeds the
failures back with an instruction to fix only those. Repeat up to 3 times.

**Honest read:** this is a self-correction loop, not tool use. It shows
iteration but no tool selection, so on its own it is a weak Yes. It is still
worth building — the contrast check especially, since an AI-picked palette that
fails WCAG is a real bug we will otherwise ship — but claim it as a supporting
detail, not the headline.

---

## 5. Supplier negotiation agent

The full section-9 vision, autonomous: the agent reads a supplier's reply,
decides the price is out of line against past offers, writes a counter-offer,
sends it, reads the response, and either settles or walks away — several email
round-trips with no human until the ranked offers appear.

**Strongest possible Yes.** Also the largest build, and it commits your users to
positions in a real business relationship with real money and real reputation.
Needs inbound email ingestion, a negotiation state machine, per-store mandate
limits, and a very good audit trail. **Not MVP.** Worth naming in the project
document as the direction of travel — "the negotiation loop is the next step
after autonomous sourcing" — which gets the credit without the exposure.

---

## 6. Catalog-setup agent that inspects the store

Rather than one generation from the questionnaire, let it call
`listCategories()`, `listAttributes()`, `sampleProducts()` and
`getStoreTheme()` first, so a store that already has ten products gets
suggestions that fit them instead of a generic proposal.

Genuine tool use, small build, low risk. But it is 2–3 calls and terminates
quickly, so it reads as *"a generation with lookups"* rather than an agent.
Good product improvement, mediocre answer to the form.

---

## If you build 1 and 2, here is the answer to the form

> **Yes.** Two loops. The **sourcing agent** runs on a schedule with a goal
> (keep stock healthy without overbuying) and eight tools — low-stock lookup,
> sales velocity over a window it chooses, calendar events, weather, supplier
> lead times and owner notes, past offers, plus two write tools: send a purchase
> request, or escalate to the owner. It decides which products to investigate
> and how deeply, then emails suppliers on its own. It stops when it has covered
> its candidates, or at a 40-step cap, or when a spend limit forces an
> escalation; every tool call, argument and stated reason is written to an
> `AgentRun` log the owner can read. The **storefront chatbot** runs the same
> pattern per message with six read tools, chaining searches whose queries are
> built from earlier results — an order lookup feeding a product lookup feeding
> a filtered search — before it composes one reply. Neither has a human choosing
> the tool. In both, the human's control is the boundary: the agent can request
> quotes but never confirms a purchase, and it can read the catalog but never
> writes to it.

Build it before you write that. The form is explicit that an undescribable Yes
is worse than a No.

---

## Cross-cutting: what any of these needs

Shared plumbing, whichever ideas get picked:

- **A tool-call loop** in `src/ai` — schemas, dispatch, step cap, transcript.
  Gemini's function-calling API supports this natively; it is a service, not a
  framework.
- **An `AgentRun` / `AgentStep` entity** — store, agent name, goal, status,
  every step with tool name, arguments, result and reason, plus token cost.
  Non-negotiable for debugging, for the dashboard, and for proving the loop
  exists.
- **Store scoping inside every tool.** The multi-tenant rule does not relax
  because a model is the caller. Scope comes from the run's context, never from
  model-supplied arguments.
- **A budget per run** — max steps and max tokens, enforced in code, not asked
  for in the prompt.
- **The scheduling story** the roadmap already defers (the Advisor needs it too,
  and so does reaping abandoned unverified accounts).
