import { Product } from '../entities/product.entity';
import { ProductStatus } from '../enums/product-status.enum';
import { AttributeValueRefDto } from './attribute-value-ref.dto';
import { ProductCategoryRefDto } from './product-category-ref.dto';
import { ProductImageDto } from './product-image.dto';
import { VariantResponseDto } from './variant-response.dto';

/**
 * The dashboard's full view of one product. `storeId`, `deletedAt` and
 * `searchVector` are omitted: the caller already knows their store, exposing it
 * only invites the mistake of accepting it back on write, and the vector is
 * machinery.
 *
 * Every variant and image route returns this whole object — the dashboard is
 * editing one thing, so a re-fetch after each edit is waste.
 */
export class ProductResponseDto {
  id!: string;
  title!: string;
  slug!: string;
  description!: string | null;
  shortDescription!: string | null;
  searchKeywords!: string | null;
  status!: ProductStatus;
  isFeatured!: boolean;
  weightGrams!: number | null;
  position!: number;
  minPriceAmount!: number;
  maxPriceAmount!: number;
  totalStock!: number;
  variantCount!: number;
  categories!: ProductCategoryRefDto[];
  attributeValues!: AttributeValueRefDto[];
  images!: ProductImageDto[];
  variants!: VariantResponseDto[];
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(product: Product): ProductResponseDto {
    const dto = new ProductResponseDto();
    dto.id = product.id;
    dto.title = product.title;
    dto.slug = product.slug;
    dto.description = product.description;
    dto.shortDescription = product.shortDescription;
    dto.searchKeywords = product.searchKeywords;
    dto.status = product.status;
    dto.isFeatured = product.isFeatured;
    dto.weightGrams = product.weightGrams;
    dto.position = product.position;
    dto.minPriceAmount = product.minPriceAmount;
    dto.maxPriceAmount = product.maxPriceAmount;
    dto.totalStock = product.totalStock;
    dto.variantCount = product.variantCount;
    dto.categories = (product.categories ?? []).map((category) =>
      ProductCategoryRefDto.fromEntity(category),
    );
    dto.attributeValues = (product.attributeValues ?? []).map((value) =>
      AttributeValueRefDto.fromEntity(value),
    );
    dto.images = (product.images ?? []).map((image) =>
      ProductImageDto.fromEntity(image),
    );
    dto.variants = (product.variants ?? []).map((variant) =>
      VariantResponseDto.fromEntity(variant),
    );
    dto.createdAt = product.createdAt;
    dto.updatedAt = product.updatedAt;
    return dto;
  }
}
