# Categories

> Part of the [E-commerce Core](./ecommerce-core.md) epic. Every shared decision
> — tenant scoping, pagination, soft delete, slugs, image uploads — is defined
> there and only referenced here.

## Overview

A store's categories are its navigation. In a normal shop they are a hardcoded
list; in a store *builder* every owner defines their own, so they are a table
with a dashboard behind it.

This is the first spec of the epic and therefore carries the shared plumbing:
`resolveCallerStore`, the pagination DTOs, the reorder pattern, and the
`Store.currency` / `Store.nextOrderNumber` columns.

## Goals

- An owner or admin can create, rename, reorder, publish and delete categories.
- A category can carry an image and a description, so it renders as a card on
  the landing page.
- An owner can mark a category **featured**, which is what the landing page
  lists.
- The storefront can list a store's published categories, ordered as the owner
  arranged them.

## Non-goals

- **Nested categories.** Flat, single level. A `parentId` self-reference is easy
  to add later; the recursive queries, the depth cap and the "what happens to
  children on delete" question are not worth it before a single store asks.
- **Auto-generating categories from the site-builder questionnaire.** Tempting,
  since the answers describe the business — but no AI runs in this epic.
- **Per-category theming.**

## Auth & access control

| Surface | Rule |
| --- | --- |
| `/categories/**` | `JwtAuthGuard` + `RolesGuard`, `@Roles(OWNER, ADMIN)` |
| `/site/:slug/categories` | public, no guard |

A `USER` (a storefront customer) has no business in the dashboard, so it is not
in the `@Roles` list.

## Data model

### `Category` (new) — `src/catalog/entities/category.entity.ts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | `@BeforeInsert` `randomUUID()`, as `User` and `Store` do |
| `storeId` | `uuid` | `@ManyToOne(() => Store, { onDelete: 'CASCADE' })` |
| `name` | `varchar` | 2–60 chars |
| `slug` | `varchar` | Unique per store, see below |
| `description` | `text` nullable | Optional blurb on the category page |
| `imageUrl` | `varchar` nullable | Cloudinary delivery URL |
| `imagePublicId` | `varchar` nullable | Needed to replace or destroy the asset |
| `position` | `int`, default `0` | Owner-defined display order |
| `isPublished` | `boolean`, default `true` | Hidden from the storefront when false |
| `isFeatured` | `boolean`, default `false` | Appears on the landing page |
| `createdAt` / `updatedAt` | timestamps | |
| `deletedAt` | `@DeleteDateColumn()` | Soft delete |

Indexes:

```ts
@Index('UQ_categories_store_slug', ['storeId', 'slug'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_categories_store_position', ['storeId', 'position'])
```

The partial unique index matters: without `WHERE "deletedAt" IS NULL`, deleting
`summer-sale` would permanently burn that slug for the store.

`products` is the inverse side of the many-to-many defined in
[products.md](./products.md); it is added when that spec lands, not here.

## Endpoints

### Dashboard

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/categories` | `CreateCategoryDto` | `CategoryResponseDto` (201) |
| `GET` | `/categories` | — (query: `CategoryQueryDto`) | `PaginatedResponseDto<CategoryResponseDto>` |
| `GET` | `/categories/:id` | — | `CategoryResponseDto` |
| `PATCH` | `/categories/:id` | `UpdateCategoryDto` | `CategoryResponseDto` |
| `DELETE` | `/categories/:id` | — | `MessageResponseDto` |
| `PATCH` | `/categories/reorder` | `ReorderCategoriesDto` | `CategoryResponseDto[]` |
| `PUT` | `/categories/:id/image` | multipart `image` | `CategoryResponseDto` |
| `DELETE` | `/categories/:id/image` | — | `CategoryResponseDto` |

`PATCH /categories/reorder` must be declared **before** `PATCH /categories/:id`
in the controller — Nest matches in declaration order and `reorder` would
otherwise be swallowed as an `:id`.

The dashboard list returns unpublished categories too; that is the point of a
dashboard. It defaults to ordering by `position ASC, createdAt ASC`.

### Storefront

| Method | Route | Returns |
| --- | --- | --- |
| `GET` | `/site/:slug/categories` | `CategoryPublicDto[]` |

Published categories of a **live** store only, ordered by `position`. A draft
store 404s, exactly as `resolvePublicStore` already behaves — an unpublished
slug must never leak.

Not paginated: a store has tens of categories, not thousands, and the storefront
navigation renders all of them at once.

## DTOs — `src/catalog/dto/`

| File | Shape |
| --- | --- |
| `create-category.dto.ts` | `name` (required, `@Length(2, 60)`), `slug?` (`@IsSlug()`, `@Length(2, 60)`), `description?` (`@Length(0, 500)`), `isPublished?`, `isFeatured?` |
| `update-category.dto.ts` | `PartialType(CreateCategoryDto)` from `@nestjs/mapped-types` |
| `reorder-categories.dto.ts` | `items: CategoryPositionDto[]` — `@ValidateNested({ each: true })`, `@ArrayMinSize(1)`, each `{ id: @IsUUID(), position: @IsInt() @Min(0) }` |
| `category-query.dto.ts` | extends `PaginationQueryDto`; `search?`, `isPublished?`, `isFeatured?` |
| `category-response.dto.ts` | Full row minus `storeId` and `deletedAt`, plus `productCount` |
| `category-public.dto.ts` | `name`, `slug`, `description`, `imageUrl`, `productCount` |

`@nestjs/mapped-types` is not yet a dependency — check before assuming
`PartialType`; if it is absent, either add it or hand-write the update DTO with
every field optional. Hand-writing is fine and matches how the site-builder DTOs
are written today.

Neither response DTO exposes `storeId`. It tells a caller nothing they can use
and only invites the mistake of accepting it back on write.

## Behaviour

### Creating

1. `resolveCallerStore(user)` → the store.
2. Slug: use the supplied `slug`, else `slugify(name)`.
3. De-duplicate: if the slug is taken in this store, append `-2`, `-3`, … until
   free. Cap the attempts (`MAX_SLUG_ATTEMPTS = 20`) and fall back to a short
   random suffix rather than looping forever.
4. `position` defaults to `MAX(position) + 1` within the store, so a new
   category lands at the end instead of colliding at `0`.
5. Insert. Catch the unique-violation (`23505`) from a concurrent create with
   the same slug and retry the de-duplication once — the same defensive shape as
   `StoreService.saveUnique`.

### Updating

- Renaming does **not** re-slug. A live category's URL is a customer-visible
  address and must not move because the owner fixed a typo. Changing the slug is
  an explicit `slug` in the body, and it goes through the same de-duplication.
- Unpublishing hides it from the storefront immediately; products in it stay
  visible through the general product listing.

### Reordering

One transaction, one `UPDATE` per item, scoped by `storeId` so a foreign id in
the payload silently matches nothing. Validate that every submitted id belongs
to the store **before** writing — a partial reorder is worse than a rejected
one. Returns the full re-ordered list so the dashboard does not need a second
request.

### Deleting

Soft delete. Products keep their `categoryId` links, but the join rows point at
a soft-deleted category, so:

- The storefront category filter stops matching it (default TypeORM behaviour
  excludes soft-deleted rows).
- A product that ends up with zero live categories is still listed — a product
  is never hidden because its category was deleted.

Its image is **not** destroyed on soft delete; a deleted-by-accident category
that is later restored would otherwise come back blank. Asset cleanup belongs to
the same reaping job that TODO.md wants for unverified accounts.

## Constants — `src/catalog/catalog.constants.ts`

```ts
export const CATEGORY_NAME_MIN_LENGTH = 2;
export const CATEGORY_NAME_MAX_LENGTH = 60;
export const CATEGORY_DESCRIPTION_MAX_LENGTH = 500;
export const CATEGORY_SUBFOLDER = 'categories';
export const CATEGORY_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const CATEGORY_IMAGE_MIME_TYPE_PATTERN = /^image\/(png|jpeg|webp)$/;
export const MAX_FEATURED_CATEGORIES = 6;
export const MAX_SLUG_ATTEMPTS = 20;
```

## Shared plumbing this spec introduces

Because it is the first branch of the epic, it also lands:

1. `StoreService.resolveCallerStore(user: JwtPayload): Promise<Store>` — see
   [ecommerce-core.md](./ecommerce-core.md) §6.
2. `src/common/dto/pagination-query.dto.ts` and
   `src/common/dto/paginated-response.dto.ts`.
3. `Store.currency` (`varchar(3)`, default `'EGP'`) and `Store.nextOrderNumber`
   (`int`, default `1`).
4. `src/catalog/catalog.module.ts`, registered in `AppModule`, importing
   `AuthModule` (for `JwtAuthGuard`) and `SiteBuilderModule` (for
   `StoreService`, which it already exports).
5. `featuredCategories` in `StorePublicResponseDto`, replacing half the
   `TODO(catalog)` marker.

## Implementation order

1. `Store.currency` + `Store.nextOrderNumber`, pagination DTOs,
   `resolveCallerStore`.
2. `Category` entity, indexes, `CatalogModule`.
3. `CategoryService` — create/update/list/get/delete + the slug helper.
4. DTOs, then `CategoriesController`.
5. Reorder and the two image routes.
6. `PublicCategoriesController` (`/site/:slug/categories`).
7. `featuredCategories` in `StorePublicResponseDto`.

## Tests

Unit (pure, no database):

- Slug de-duplication: taken → `-2`; `-2` also taken → `-3`; exhausted → random
  suffix.

Endpoint checks:

- Create → appears in the dashboard list and, once published, in the storefront
  list.
- Two categories named "Summer Sale" in one store → second slug is
  `summer-sale-2`.
- The *same* slug in two different stores → both succeed.
- Category of store B, requested by an owner of store A, by id → 404 on `GET`,
  `PATCH`, `DELETE`.
- `storeId` in the body → 400 `property storeId should not exist`.
- Reorder with a foreign id in the payload → 400, and nothing is written.
- Unpublished category is absent from `/site/:slug/categories` and present in
  `/categories`.
- Draft store slug → `/site/:slug/categories` 404s.
- Delete → gone from both lists; re-creating the same name reuses the freed slug.
- `USER` role token on any `/categories` route → 403.
- 6 MB image → 400 from `MaxFileSizeValidator`; a PDF renamed `.png` → 400.
- Replacing an image destroys the old Cloudinary asset (check the dashboard).

## Considered and rejected

- **Hard delete.** Loses the join target for historical orders and burns the
  slug's uniqueness story. Soft delete costs one column.
- **Ordering by `name` and dropping `position`.** An owner's navigation order is
  a merchandising decision ("Best Sellers" first), not alphabetical.
- **A `position` gap strategy (10, 20, 30…) to make single moves cheap.** The
  whole-list reorder payload is simpler, and a store has tens of categories, not
  tens of thousands.

## Deferred

- Nested categories (`parentId`, depth cap, delete-cascade semantics).
- Destroying Cloudinary assets when a soft-deleted row is finally reaped.
- Per-category SEO fields (meta title/description) — belongs with a storefront
  SEO feature, not here.
