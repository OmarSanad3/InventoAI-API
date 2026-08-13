import { AttributeDisplayStyle } from '../enums/attribute-display-style.enum';
import {
  CatalogProposal,
  ProposedAttribute,
  ProposedAttributeValue,
  ProposedCategory,
} from '../utils/sanitize-catalog.util';

export class ProposedCategoryDto {
  name!: string;
  description!: string | null;

  static fromProposal(category: ProposedCategory): ProposedCategoryDto {
    const dto = new ProposedCategoryDto();
    dto.name = category.name;
    dto.description = category.description ?? null;
    return dto;
  }
}

export class ProposedAttributeValueDto {
  value!: string;
  swatchHex!: string | null;

  static fromProposal(
    value: ProposedAttributeValue,
  ): ProposedAttributeValueDto {
    const dto = new ProposedAttributeValueDto();
    dto.value = value.value;
    dto.swatchHex = value.swatchHex ?? null;
    return dto;
  }
}

export class ProposedAttributeDto {
  name!: string;
  key!: string;
  isVariantAxis!: boolean;
  displayStyle!: AttributeDisplayStyle;
  values!: ProposedAttributeValueDto[];

  static fromProposal(attribute: ProposedAttribute): ProposedAttributeDto {
    const dto = new ProposedAttributeDto();
    dto.name = attribute.name;
    dto.key = attribute.key;
    dto.isVariantAxis = attribute.isVariantAxis;
    dto.displayStyle = attribute.displayStyle;
    dto.values = attribute.values.map((value) =>
      ProposedAttributeValueDto.fromProposal(value),
    );
    return dto;
  }
}

/**
 * What one generation proposes. **Nothing here is persisted** — the client
 * holds it, the owner edits it, and it comes back to `POST /catalog/apply` as
 * ordinary untrusted input that the server re-validates from scratch.
 *
 * The array order is the `position` the owner will see: sizes read S, M, L, XL,
 * 2XL because the model understands sizes, and nothing sorts them afterwards.
 */
export class CatalogProposalDto {
  categories!: ProposedCategoryDto[];
  attributes!: ProposedAttributeDto[];

  static fromProposal(proposal: CatalogProposal): CatalogProposalDto {
    const dto = new CatalogProposalDto();
    dto.categories = proposal.categories.map((category) =>
      ProposedCategoryDto.fromProposal(category),
    );
    dto.attributes = proposal.attributes.map((attribute) =>
      ProposedAttributeDto.fromProposal(attribute),
    );
    return dto;
  }
}
