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

  static fromEntity(category: Category): CategoryPublicDto {
    const dto = new CategoryPublicDto();
    dto.name = category.name;
    dto.slug = category.slug;
    dto.description = category.description;
    dto.imageUrl = category.imageUrl;
    return dto;
  }
}
