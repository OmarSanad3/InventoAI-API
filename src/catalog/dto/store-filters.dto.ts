import { AttributeDisplayStyle } from '../enums/attribute-display-style.enum';

export class FilterPriceRangeDto {
  min!: number;
  max!: number;
}

export class FilterCategoryDto {
  name!: string;
  slug!: string;
  count!: number;
}

export class FilterValueDto {
  slug!: string;
  value!: string;
  swatchHex!: string | null;
  /** `0` is returned, not omitted — options that vanish feel broken. */
  count!: number;
}

export class FilterAttributeDto {
  key!: string;
  name!: string;
  displayStyle!: AttributeDisplayStyle;
  isVariantAxis!: boolean;
  values!: FilterValueDto[];
}

/**
 * What the storefront sidebar renders itself from. It takes the **same** query
 * parameters as the product listing, because the counts have to reflect the
 * filters already applied.
 *
 * `displayStyle` and `swatchHex` come straight through so the sidebar never has
 * to guess from an attribute's name — `swatch` draws coloured circles, `chip`
 * neutral ones with the text inside.
 */
export class StoreFiltersDto {
  price!: FilterPriceRangeDto;
  categories!: FilterCategoryDto[];
  attributes!: FilterAttributeDto[];
}
