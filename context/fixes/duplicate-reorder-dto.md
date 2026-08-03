# Fix the Duplicated Reorder DTO

> Deferred cleanup, found while implementing
> [product-attributes.md](../features/product-attributes.md) (e-commerce core
> branch 2). Not urgent — nothing is broken — so it waits for a branch that
> touches categories anyway.

## Problem

Two DTOs describe the same request body, field for field:

| | `src/catalog/dto/reorder-categories.dto.ts` | `src/common/dto/reorder.dto.ts` |
| --- | --- | --- |
| Item class | `CategoryPositionDto` | `PositionItemDto` |
| Item fields | `@IsUUID() id`, `@IsInt() @Min(0) position` | same |
| Wrapper | `@IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(...) items` | same |

Only the class names differ. `PATCH /categories/reorder` and
`PATCH /product-attributes/reorder` already accept byte-identical JSON.

## Root Cause

[categories.md](../features/categories.md) established the reorder shape and
named its DTO after the feature. Branch 2 needed the same shape for attributes
*and* for attribute values, and specs 3, 5 and 6 (products, FAQ, orders) each
want it again — so it was extracted to `src/common/dto/reorder.dto.ts` as
`ReorderDto`.

The categories copy was deliberately left in place: it is merged, verified code,
and rewriting it was outside branch 2's scope. That is the right call per commit,
and the wrong state to leave permanently — the next feature that copies the
nearest example will copy the wrong one.

## Solution

Delete the categories copy and point it at the common DTO. No behaviour change:
same validators, same body, same errors.

## Changes Required

1. `src/catalog/categories.controller.ts` — replace the
   `ReorderCategoriesDto` import with
   `import { ReorderDto } from '../common/dto/reorder.dto';` and retype the
   `reorder` handler's `@Body()`.
2. `src/catalog/category.service.ts` — same import swap; `CategoryService.reorder`
   takes `dto: ReorderDto`.
3. Delete `src/catalog/dto/reorder-categories.dto.ts`.

## Verification

- `npm run build` and `npm run lint`.
- `PATCH /categories/reorder` with a valid list still reorders, and one with a
  foreign id still 400s `Every category must belong to your store and appear
  once` without writing anything.

## Notes

Apply the same rule to whatever the remaining specs add: a request shape used by
more than one feature belongs in `src/common/dto/`, named for the shape
(`ReorderDto`) rather than for its first caller.