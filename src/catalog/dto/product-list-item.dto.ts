import { Product } from '../entities/product.entity';
import { ProductStatus } from '../enums/product-status.enum';
import { findPrimaryImage } from '../utils/primary-image.util';
import { ProductCategoryRefDto } from './product-category-ref.dto';

/**
 * One row of the dashboard's product table. Variants are summarised into the
 * derived columns rather than shipped whole — a table of 20 products would
 * otherwise carry hundreds of variant objects nobody renders.
 */
export class ProductListItemDto {
  id!: string;
  title!: string;
  slug!: string;
  status!: ProductStatus;
  isFeatured!: boolean;
  position!: number;
  minPriceAmount!: number;
  maxPriceAmount!: number;
  totalStock!: number;
  variantCount!: number;
  imageUrl!: string | null;
  categories!: ProductCategoryRefDto[];
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(product: Product): ProductListItemDto {
    const dto = new ProductListItemDto();
    dto.id = product.id;
    dto.title = product.title;
    dto.slug = product.slug;
    dto.status = product.status;
    dto.isFeatured = product.isFeatured;
    dto.position = product.position;
    dto.minPriceAmount = product.minPriceAmount;
    dto.maxPriceAmount = product.maxPriceAmount;
    dto.totalStock = product.totalStock;
    dto.variantCount = product.variantCount;
    dto.imageUrl = findPrimaryImage(product.images)?.url ?? null;
    dto.categories = (product.categories ?? []).map((category) =>
      ProductCategoryRefDto.fromEntity(category),
    );
    dto.createdAt = product.createdAt;
    dto.updatedAt = product.updatedAt;
    return dto;
  }
}
