import { ProductAttributeValue } from '../entities/product-attribute-value.entity';

/** One entry of the controlled vocabulary, as the dashboard sees it. */
export class AttributeValueResponseDto {
  id!: string;
  value!: string;
  slug!: string;
  swatchHex!: string | null;
  position!: number;

  static fromEntity(value: ProductAttributeValue): AttributeValueResponseDto {
    const dto = new AttributeValueResponseDto();
    dto.id = value.id;
    dto.value = value.value;
    dto.slug = value.slug;
    dto.swatchHex = value.swatchHex;
    dto.position = value.position;
    return dto;
  }
}
