import { Category } from '../entities/category.entity';

/**
 * What the storefront renders a category card and its navigation entry from.
 * Ids and publication flags stay in the dashboard — a shopper addresses a
 * category by its slug.
 */
export class CategoryPublicDto {
  name!: string;
  slug!: string;
  description!: string | null;
  imageUrl!: string | null;
  /**
   * Active products only — a draft is not something a shopper can buy. `null`
   * where a count was never asked for, such as the category chips on a product
   * card; a `0` there would read as "this category is empty", which is a lie.
   */
  productCount!: number | null;

  static fromEntity(category: Category): CategoryPublicDto {
    const dto = new CategoryPublicDto();
    dto.name = category.name;
    dto.slug = category.slug;
    dto.description = category.description;
    dto.imageUrl = category.imageUrl;
    dto.productCount = category.productCount ?? null;
    return dto;
  }
}
