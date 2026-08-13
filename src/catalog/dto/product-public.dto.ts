import { Product } from '../entities/product.entity';
import { AttributeDisplayStyle } from '../enums/attribute-display-style.enum';
import { CategoryPublicDto } from './category-public.dto';
import { ProductImageDto } from './product-image.dto';
import { VariantPublicDto } from './variant-public.dto';

/** One row of the detail page's spec table — "Material: Cotton, Linen". */
export class ProductSpecDto {
  key!: string;
  name!: string;
  displayStyle!: AttributeDisplayStyle;
  values!: { value: string; slug: string; swatchHex: string | null }[];
}

/**
 * The storefront's product detail page.
 *
 * The frontend builds its picker from `variants`: the backend does not model
 * which combinations are valid beyond the ones that exist, so a combination
 * absent from the array is a combination the store does not sell.
 */
export class ProductPublicDto {
  title!: string;
  slug!: string;
  description!: string | null;
  shortDescription!: string | null;
  images!: ProductImageDto[];
  categories!: CategoryPublicDto[];
  /** Descriptive attributes, grouped — the axes live on the variants instead. */
  specs!: ProductSpecDto[];
  variants!: VariantPublicDto[];
  minPriceAmount!: number;
  maxPriceAmount!: number;
  variantCount!: number;
  inStock!: boolean;

  static fromEntity(product: Product): ProductPublicDto {
    const dto = new ProductPublicDto();
    dto.title = product.title;
    dto.slug = product.slug;
    dto.description = product.description;
    dto.shortDescription = product.shortDescription;
    dto.images = [...(product.images ?? [])]
      .sort((left, right) => left.position - right.position)
      .map((image) => ProductImageDto.fromEntity(image));
    dto.categories = (product.categories ?? [])
      .filter((category) => category.isPublished)
      .map((category) => CategoryPublicDto.fromEntity(category));
    dto.specs = buildSpecs(product);
    dto.variants = (product.variants ?? []).map((variant) =>
      VariantPublicDto.fromEntity(variant),
    );
    dto.minPriceAmount = product.minPriceAmount;
    dto.maxPriceAmount = product.maxPriceAmount;
    dto.variantCount = product.variantCount;
    dto.inStock = product.totalStock > 0;
    return dto;
  }
}

/**
 * Groups the descriptive values by their attribute, skipping the ones the owner
 * marked `showOnProductPage = false`.
 */
function buildSpecs(product: Product): ProductSpecDto[] {
  const specs = new Map<string, ProductSpecDto>();

  for (const value of product.attributeValues ?? []) {
    const attribute = value.attribute;
    if (!attribute?.showOnProductPage) {
      continue;
    }

    const spec = specs.get(attribute.id) ?? {
      key: attribute.key,
      name: attribute.name,
      displayStyle: attribute.displayStyle,
      values: [],
    };
    spec.values.push({
      value: value.value,
      slug: value.slug,
      swatchHex: value.swatchHex,
    });
    specs.set(attribute.id, spec);
  }

  return [...specs.values()];
}
