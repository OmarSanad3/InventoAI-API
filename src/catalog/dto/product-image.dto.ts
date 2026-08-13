import { ProductImage } from '../entities/product-image.entity';

/** One gallery image. `position = 0` is the primary one. */
export class ProductImageDto {
  id!: string;
  url!: string;
  position!: number;
  altText!: string | null;

  static fromEntity(image: ProductImage): ProductImageDto {
    const dto = new ProductImageDto();
    dto.id = image.id;
    dto.url = image.url;
    dto.position = image.position;
    dto.altText = image.altText;
    return dto;
  }
}
