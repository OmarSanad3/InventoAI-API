import { ProductAttribute } from '../entities/product-attribute.entity';
import { AttributeDisplayStyle } from '../enums/attribute-display-style.enum';
import { AttributeValueResponseDto } from './attribute-value-response.dto';

/**
 * The dashboard's view of an attribute, values included — every value route
 * returns the whole object, because the dashboard is editing one thing and a
 * re-fetch after each keystroke is waste.
 *
 * `storeId` and `deletedAt` are omitted: the caller already knows their store,
 * and exposing it only invites the mistake of accepting it back on write.
 *
 * TODO(products): add `productCount` once products can reference a value
 * ([features/products.md](../../../context/features/products.md)). It is absent
 * rather than hardcoded to `0`, for the same reason `CategoryResponseDto` left
 * its count out — the response never advertises a number the backend cannot
 * compute.
 */
export class AttributeResponseDto {
  id!: string;
  name!: string;
  key!: string;
  isVariantAxis!: boolean;
  isFilterable!: boolean;
  showOnProductPage!: boolean;
  displayStyle!: AttributeDisplayStyle;
  position!: number;
  values!: AttributeValueResponseDto[];
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(attribute: ProductAttribute): AttributeResponseDto {
    const dto = new AttributeResponseDto();
    dto.id = attribute.id;
    dto.name = attribute.name;
    dto.key = attribute.key;
    dto.isVariantAxis = attribute.isVariantAxis;
    dto.isFilterable = attribute.isFilterable;
    dto.showOnProductPage = attribute.showOnProductPage;
    dto.displayStyle = attribute.displayStyle;
    dto.position = attribute.position;
    dto.values = (attribute.values ?? []).map((value) =>
      AttributeValueResponseDto.fromEntity(value),
    );
    dto.createdAt = attribute.createdAt;
    dto.updatedAt = attribute.updatedAt;
    return dto;
  }
}
