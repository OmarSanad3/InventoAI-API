import { Category } from '../entities/category.entity';

/**
 * A category as it appears inside a product. The id is here — unlike
 * `CategoryPublicDto` — because the dashboard's category picker round-trips it.
 */
export class ProductCategoryRefDto {
  id!: string;
  name!: string;
  slug!: string;

  static fromEntity(category: Category): ProductCategoryRefDto {
    const dto = new ProductCategoryRefDto();
    dto.id = category.id;
    dto.name = category.name;
    dto.slug = category.slug;
    return dto;
  }
}
