import { ProductAttributeValue } from '../entities/product-attribute-value.entity';

/**
 * An attribute value as it appears *inside* a product or variant: the value
 * itself plus enough of its parent attribute that the dashboard can label it
 * without a second lookup.
 *
 * Requires the `attribute` relation to be loaded; the fields fall back to the
 * ids when it is not, rather than throwing inside a response mapper.
 */
export class AttributeValueRefDto {
  id!: string;
  attributeId!: string;
  attributeKey!: string;
  attributeName!: string;
  value!: string;
  slug!: string;
  swatchHex!: string | null;

  static fromEntity(value: ProductAttributeValue): AttributeValueRefDto {
    const dto = new AttributeValueRefDto();
    dto.id = value.id;
    dto.attributeId = value.attributeId;
    dto.attributeKey = value.attribute?.key ?? '';
    dto.attributeName = value.attribute?.name ?? '';
    dto.value = value.value;
    dto.slug = value.slug;
    dto.swatchHex = value.swatchHex;
    return dto;
  }
}
