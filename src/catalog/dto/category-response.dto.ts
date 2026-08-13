import { Category } from '../entities/category.entity';

/**
 * The dashboard's view of a category. `storeId` and `deletedAt` are omitted:
 * the caller already knows their store, and exposing it only invites the
 * mistake of accepting it back on write.
 *
 * `productCount` counts drafts too — the owner is looking for their own work in
 * progress, unlike `CategoryPublicDto`, which counts only what can be bought.
 */
export class CategoryResponseDto {
  id!: string;
  name!: string;
  slug!: string;
  description!: string | null;
  imageUrl!: string | null;
  position!: number;
  isPublished!: boolean;
  isFeatured!: boolean;
  productCount!: number;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(category: Category): CategoryResponseDto {
    const dto = new CategoryResponseDto();
    dto.id = category.id;
    dto.name = category.name;
    dto.slug = category.slug;
    dto.description = category.description;
    dto.imageUrl = category.imageUrl;
    dto.position = category.position;
    dto.isPublished = category.isPublished;
    dto.isFeatured = category.isFeatured;
    dto.productCount = category.productCount ?? 0;
    dto.createdAt = category.createdAt;
    dto.updatedAt = category.updatedAt;
    return dto;
  }
}
