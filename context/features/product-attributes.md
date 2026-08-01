# Product Attributes

> Part of the [E-commerce Core](./ecommerce-core.md) epic. Every shared decision
> — tenant scoping, pagination, soft delete, slugs — is defined there and only
> referenced here. Ships before [products.md](./products.md), because product
> and variant writes validate against it.

## Overview

This is the spec that makes InventoAI a store **builder** rather than a store.

A single shop hardcodes its product columns: a clothing shop's `products` table
has `size` and `color`, a bookshop's has `author` and `isbn`. A builder cannot,
because it does not know what its stores sell. So the columns become rows: each
store declares its own attributes, and the platform ships only the ones every
store shares.

That produces two tiers on the storefront's products page:

| Tier | Examples | Where they come from |
| --- | --- | --- |
| **Built-in** | price range, category, availability, search, sort | Hardcoded; every store has them |
| **Store-defined** | Size, Color, Material, Brand | Rows in `product_attributes`, created by the owner |

A mug shop defines nothing and its sidebar shows the built-ins alone. A clothing
shop defines Size and Color and gets two more sections, on the sidebar, on the
product page, and in the query string.

## The distinction that shapes everything

Not every attribute is the same kind of thing, and conflating the two is what
makes catalog models rot:

- **Variant axes** — Size, Color. They change SKU, price and stock. A shopper
  *picks* one before adding to cart. "3 left in M" is a sentence that must be
  expressible.
- **Descriptive** — Material, Brand, Origin, Warranty. They describe the whole
  product. They filter and they display, but nobody picks them, and they have no
  stock of their own.

One boolean on the attribute — `isVariantAxis` — decides which it is, and that
single flag gives every store shape out of one model:

| Store | Attributes defined | Result |
| --- | --- | --- |
| Mugs | none | One product, one price, one stock number |
| Hardware | `Material` (descriptive) | One product, one stock number, and a Material filter |
| Clothing | `Size` + `Color` (axes) | Real per-combination SKU, price and stock |

The simple stores never pay for the complex ones.

## Goals

- An owner or admin can define the attributes their store uses, name them, order
  them, and choose where each appears.
- Each attribute owns a controlled list of values, so a product **picks** "XL"
  from a dropdown instead of typing a string.
- An attribute is marked either a variant axis or descriptive, which is what
  [products.md](./products.md) reads to decide whether to build variants.
- Renaming a value is one write, and every product that uses it follows.

## Non-goals

- **The storefront `/filters` endpoint.** The definitions are only half of it;
  the other half is per-value product counts, which cannot exist before
  `Product` does. It ships with [products.md](./products.md), for the same
  reason `productCount` was left off `CategoryResponseDto`.
- **Attribute groups / tabs on the product page.** A flat, ordered list.
- **Per-category attributes** ("Size only applies to Clothing"). Attributes are
  store-wide. A product simply does not use the ones that do not apply to it,
  and the sidebar hides a facet with no matching products anyway.
- **Free-text attributes.** Every attribute has a controlled value list — see
  the rationale below.
- **Numeric or range attributes** (`Weight between 1–5 kg`). Values are discrete
  tokens in v1.
- **Generating attributes from the site-builder questionnaire.** That is
  [catalog-ai-setup.md](./catalog-ai-setup.md), which builds on this spec's
  entities and writes through this spec's service. This branch ships the
  hand-driven dashboard; the AI is the layer above it.

### Why no free-text values

The obvious cheap design is a free-form `Record<string, string>` on the product.
It fails at exactly the job it exists for. One owner types `XL`, `xl`,
`X-Large` and `extra large` across four products, and the sidebar then renders
four separate checkboxes that each match one product. Filters built on
unconstrained strings do not filter.

A controlled value list costs one extra table and removes the whole class of
problem. It is also what makes "rename XL to Extra Large" a single `UPDATE`
rather than a rewrite of every product row.

## Auth & access control

| Surface | Rule |
| --- | --- |
| `/product-attributes/**` | `JwtAuthGuard` + `RolesGuard`, `@Roles(OWNER, ADMIN)` |

No public surface in this spec — see Non-goals.

## Data model

### `ProductAttribute` (new) — `src/catalog/entities/product-attribute.entity.ts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | `@BeforeInsert` `randomUUID()` |
| `storeId` | `uuid` | `@ManyToOne(() => Store, { onDelete: 'CASCADE' })` |
| `name` | `varchar` | Display label — "Size", 2–40 chars |
| `key` | `varchar` | URL/API token — `size`. Unique per store, `@IsSlug()` |
| `isVariantAxis` | `boolean`, default `false` | The flag above. Immutable once products use it |
| `isFilterable` | `boolean`, default `true` | Appears in the storefront sidebar |
| `showOnProductPage` | `boolean`, default `true` | Appears in the detail page's spec table |
| `displayStyle` | `enum AttributeDisplayStyle` | `list \| swatch \| dropdown` — a frontend hint |
| `position` | `int`, default `0` | Sidebar order |
| `createdAt` / `updatedAt` | timestamps | |
| `deletedAt` | `@DeleteDateColumn()` | Soft delete |

```ts
@Index('UQ_product_attributes_store_key', ['storeId', 'key'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_product_attributes_store_position', ['storeId', 'position'])

@OneToMany(() => ProductAttributeValue, (value) => value.attribute)
values!: ProductAttributeValue[];
```

`key` is separate from `name` for the same reason `Category.slug` is separate
from `Category.name`: the name is customer-facing copy the owner will re-word,
and the key is an address that appears in bookmarked URLs. Renaming "Size" to
"Sizing" must not break `?attributes=size:xl`.

**Reserved keys.** A key may not collide with a built-in query parameter, or the
storefront cannot tell a facet from a control:

```ts
export const RESERVED_ATTRIBUTE_KEYS = [
  'category', 'search', 'sort', 'order', 'page', 'limit',
  'minprice', 'maxprice', 'instock', 'attributes',
] as const;
```

Checked case-insensitively, 400 on collision, in the same place the slug is
validated.

### `ProductAttributeValue` (new) — `src/catalog/entities/product-attribute-value.entity.ts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `attributeId` | `uuid` | `@ManyToOne(() => ProductAttribute, { onDelete: 'CASCADE' })` |
| `storeId` | `uuid` | Denormalised — see below |
| `value` | `varchar` | Display text — "Extra Large", 1–60 chars |
| `slug` | `varchar` | URL token — `extra-large`. Unique per attribute |
| `swatchHex` | `varchar(7)` nullable | `#RRGGBB`, only meaningful when `displayStyle = swatch` |
| `position` | `int`, default `0` | Order within the facet — S, M, L, not L, M, S |
| `createdAt` / `updatedAt` | timestamps | |
| `deletedAt` | `@DeleteDateColumn()` | Soft delete |

```ts
@Index('UQ_attribute_values_attribute_slug', ['attributeId', 'slug'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_attribute_values_store', ['storeId'])
```

`storeId` is denormalised off the attribute deliberately. Every storefront filter
query joins from products to values and must be store-scoped; carrying the id
saves a join to `product_attributes` on the hottest query in the catalog. It is
written once at insert from the parent and never edited — the parent's `storeId`
is immutable too, so the two cannot drift.

`position` matters more than it looks. Sizes sort S, M, L, XL — an ordering no
alphabetical or numeric sort produces. Only the owner knows it.

### `AttributeDisplayStyle` — `src/catalog/enums/attribute-display-style.enum.ts`

```ts
export enum AttributeDisplayStyle {
  List = 'list',         // checkbox list — the default
  Swatch = 'swatch',     // colour circles, reads swatchHex
  Chip = 'chip',         // uniform circles with the value's text inside
  Dropdown = 'dropdown', // a select, for long lists like Brand
}
```

Purely a rendering hint. The backend never behaves differently on it; it is
stored here because it is per-store configuration and the frontend has nowhere
else to keep it.

#### Rendering contract

The frontend and the API have to agree on what each style means, or the sidebar
and the product picker drift apart. This table is that agreement, and it is the
reason `swatchHex` exists at all:

| Style | Renders as | Uses `swatchHex` | Typical attribute |
| --- | --- | --- | --- |
| `swatch` | A filled circle per value, in that colour, with the name as its tooltip and accessible label | **Required** on every value | Colour |
| `chip` | A circle (or pill) per value, uniform neutral fill, the value's text inside — `S`, `M`, `XL` | Never | Size |
| `list` | A checkbox and label per value, stacked | Never | Material, Brand |
| `dropdown` | A single `<select>` | Never | Brand with 50 entries |

`swatch` and `chip` are the same control with a different fill: one is coloured
and silent, the other is neutral and lettered. Splitting them means the client
does not have to guess from the attribute's name whether `#e11d48` or the text
is the thing to show — and guessing from the name breaks the moment a store
names it "Colour", "Couleur" or "اللون".

Two rules the service enforces, so the client can trust the contract rather than
defend against it:

- `displayStyle = swatch` → **every** value must carry a valid `swatchHex`. A
  colourless colour swatch renders as an invisible button.
- `displayStyle ≠ swatch` → `swatchHex` must be absent. Storing a colour nothing
  will ever render is how a schema accumulates lies.

Both are checked on attribute create/update *and* on value create/update, since
either side can break the pair. Changing an attribute to `swatch` while its
values have no hex is a 400 listing the values that need one.

## Endpoints

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/product-attributes` | `CreateAttributeDto` | `AttributeResponseDto` (201) |
| `GET` | `/product-attributes` | query `AttributeQueryDto` | `AttributeResponseDto[]` |
| `GET` | `/product-attributes/:id` | — | `AttributeResponseDto` |
| `PATCH` | `/product-attributes/:id` | `UpdateAttributeDto` | `AttributeResponseDto` |
| `DELETE` | `/product-attributes/:id` | — | `MessageResponseDto` |
| `PATCH` | `/product-attributes/reorder` | `ReorderDto` | `AttributeResponseDto[]` |
| `POST` | `/product-attributes/:id/values` | `CreateAttributeValueDto` | `AttributeResponseDto` |
| `PATCH` | `/product-attributes/:id/values/:valueId` | `UpdateAttributeValueDto` | `AttributeResponseDto` |
| `DELETE` | `/product-attributes/:id/values/:valueId` | — | `AttributeResponseDto` |
| `PATCH` | `/product-attributes/:id/values/reorder` | `ReorderDto` | `AttributeResponseDto` |

`reorder` is declared before `:id`, as in categories.

**Not paginated.** `MAX_ATTRIBUTES_PER_STORE` is 20 and the dashboard renders
all of them at once — the same reasoning that left `/site/:slug/categories`
unpaginated. `AttributeQueryDto` therefore carries filters only
(`isVariantAxis?`, `isFilterable?`), not `page`/`limit`.

Every value route returns the **whole attribute** with its values, not the bare
value. The dashboard is editing one object; returning it saves a re-fetch after
every keystroke on the value editor.

`ReorderDto` is the shape categories already established — `items: [{ id,
position }]`, validated wholesale before anything is written.

## DTOs — `src/catalog/dto/`

| File | Shape |
| --- | --- |
| `create-attribute.dto.ts` | `name`, `key?`, `isVariantAxis?`, `isFilterable?`, `showOnProductPage?`, `displayStyle?`, `values?: CreateAttributeValueDto[]` |
| `update-attribute.dto.ts` | every field optional, **no** `isVariantAxis` — see below |
| `create-attribute-value.dto.ts` | `value`, `slug?`, `swatchHex?` |
| `update-attribute-value.dto.ts` | all optional |
| `attribute-query.dto.ts` | `isVariantAxis?`, `isFilterable?` |
| `attribute-response.dto.ts` | the row minus `storeId`/`deletedAt`, plus `values: AttributeValueResponseDto[]` and `productCount` |
| `attribute-value-response.dto.ts` | `id`, `value`, `slug`, `swatchHex`, `position` |

`values` on create is a convenience: an owner defines "Size" with S/M/L in one
request rather than four. Capped at `MAX_VALUES_PER_ATTRIBUTE`, and each goes
through the same slug de-duplication as a single create.

`swatchHex` is validated against `SWATCH_HEX_PATTERN` and paired with
`displayStyle` per the rendering contract above — required for `swatch`,
rejected for everything else.

## Behaviour

### Creating

Mirrors `CategoryService.create` step for step: derive `key` with `slugify(name)`
unless supplied, de-duplicate with `buildUniqueSlug` against the store's existing
keys, reject reserved keys, default `position` to `MAX(position) + 1`, and retry
once on a `23505` from a concurrent create.

`buildUniqueSlug` already exists from [categories.md](./categories.md) and is
reused unchanged — that was the point of extracting it as a pure function.

### `isVariantAxis` is immutable once used

Flipping it on a store with products is not an edit, it is a migration:

- `descriptive → axis` would mean every existing product needs variants built
  retroactively, and there is no correct answer for what stock to give them.
- `axis → descriptive` would orphan every variant that exists only to hold that
  axis, and silently merge products that were deliberately distinct.

So `UpdateAttributeDto` does not carry the field at all. Changing it means
deleting the attribute and creating a new one, which forces the owner to confront
what happens to their products instead of discovering it later. An attribute with
**zero** products attached may be recreated freely, so this costs nothing during
setup, which is when owners actually change their minds.

### Deleting

Soft delete, with a guard: an attribute or value still referenced by a live
product is a **409** naming the count — "12 products still use this value".
Deleting it anyway would leave variants whose defining combination no longer
exists, which is a row that can be bought but not described.

The dashboard's route out is the same one the owner wants anyway: unfilter it
(`isFilterable = false`) to hide it from the storefront without touching the
catalog.

A value with no products attached deletes freely.

### Renaming

`value` and `name` are free to change at any time and every product follows
immediately, because products reference the value by **id**, never by text. That
is the entire payoff of the controlled list, and it is worth stating in the spec
so nobody later "optimises" it into a denormalised string.

`slug` and `key` may also change, with the same de-duplication as creation — but
be aware they are customer-visible addresses, so the dashboard should warn.
Renaming does not re-slug automatically, exactly as categories decided.

## Constants — added to `src/catalog/catalog.constants.ts`

```ts
export const ATTRIBUTE_NAME_MIN_LENGTH = 2;
export const ATTRIBUTE_NAME_MAX_LENGTH = 40;
export const ATTRIBUTE_KEY_MIN_LENGTH = 2;
export const ATTRIBUTE_KEY_MAX_LENGTH = 40;
export const ATTRIBUTE_VALUE_MIN_LENGTH = 1;
export const ATTRIBUTE_VALUE_MAX_LENGTH = 60;

export const MAX_ATTRIBUTES_PER_STORE = 20;
export const MAX_VALUES_PER_ATTRIBUTE = 100;

export const SWATCH_HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const RESERVED_ATTRIBUTE_KEYS: readonly string[] = [
  'category', 'search', 'sort', 'order', 'page', 'limit',
  'minprice', 'maxprice', 'instock', 'attributes',
];
```

The per-product caps (`MAX_VARIANT_AXES_PER_PRODUCT`,
`MAX_VARIANTS_PER_PRODUCT`) belong to [products.md](./products.md), since this
spec knows nothing about products.

## Implementation order

1. `AttributeDisplayStyle` enum, both entities, indexes. `CatalogModule` already
   exists from categories — this only extends `TypeOrmModule.forFeature`.
2. `ProductAttributeService` — create/list/get/update/delete + reorder, reusing
   `buildUniqueSlug` and the reserved-key check.
3. DTOs, then `ProductAttributesController`.
4. Value routes: add, update, delete, reorder.
5. The in-use guard on delete. It needs `Product`, which does not exist yet —
   ship it as a private `countProductsUsing()` returning `0` with a
   `TODO(products)`, and close it in the products branch. **This is the one
   deliberate stub in the epic**, and it is safe because until products exist
   nothing can reference a value.

## Tests

Unit (pure, no database):

- Reserved-key rejection, case-insensitive.
- `buildUniqueSlug` against attribute keys — already covered by the categories
  suite; add a case only if the key rules diverge.
- `swatchHex` validation: `#FFF` rejected, `#ffffff` accepted, absent accepted.

Endpoint checks:

- Create "Size" with values S/M/L in one request → one attribute, three values,
  positions 0–2.
- Duplicate name in one store → second key is `size-2`; the same key in two
  different stores → both succeed.
- A reserved key (`category`, `sort`) → 400.
- `isVariantAxis` in a `PATCH` body → 400 `property isVariantAxis should not
  exist`.
- Attribute of store B by id from store A's owner → 404 on every verb.
- Reorder with a foreign id → 400, nothing written.
- Delete a value with no products → 200; the freed slug can be reused.
- `USER` role token on any route → 403.
- `swatchHex` on a `list`-style attribute → 400.

Plus the epic-wide cross-tenant test from
[ecommerce-core.md](./ecommerce-core.md).

## Considered and rejected

- **`Product.attributes` as free-form jsonb**, the original design in this
  epic. Rejected for the reasons above, and because the sidebar needs per-value
  counts — a `GROUP BY` over a join table, versus an aggregation over jsonb keys
  that no index helps.
- **A `Filter` entity instead of `ProductAttribute`.** A filter is what an
  attribute *becomes* in the sidebar, but the same definition also renders the
  product page's spec table and defines variants. Naming the entity after one of
  its three consumers would misname the other two.
- **Attributes as a global platform catalogue** ("Size" defined once, shared by
  every store). Tempting for consistency and it would let the Advisor compare
  across stores — but one store's "Size" is S/M/L and another's is 38/40/42, and
  a shared vocabulary means one store's edit changes another's storefront. Hard
  no for a multi-tenant builder.
- **Per-category attributes.** More precise, but it needs a join table, a
  resolution rule for products in several categories, and a story for what
  happens when a product leaves a category. Store-wide attributes plus "the
  sidebar hides empty facets" gets the same visible result for free.
- **Allowing `isVariantAxis` to be edited.** See above — it is a data migration
  wearing a boolean's clothes.

## Deferred

- The storefront `/site/:slug/filters` endpoint with counts —
  [products.md](./products.md).
- Free-text and numeric-range attributes.
- Per-category attribute scoping.
- Merging two values the owner created by accident ("Red" and "red").
- Per-value images, so a colour swatch can show the fabric rather than a flat
  hex.
