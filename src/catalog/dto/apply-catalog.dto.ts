import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import {
  MAX_ATTRIBUTES_PER_STORE,
  MAX_GENERATED_CATEGORIES,
} from '../catalog.constants';
import { CreateAttributeDto } from './create-attribute.dto';
import { CreateCategoryDto } from './create-category.dto';

/**
 * The proposal after the owner edited it, sent back in full.
 *
 * The entries are the **same DTOs the hand-driven routes take**, so a generated
 * category and a typed one are validated by one set of rules — name lengths,
 * reserved keys, the swatch/hex pairing, the caps. By the time a proposal comes
 * back it is untrusted client input like any other.
 *
 * Both arrays are optional and may be empty: an owner who wants only the
 * attributes sends only the attributes.
 */
export class ApplyCatalogDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_GENERATED_CATEGORIES)
  @ValidateNested({ each: true })
  @Type(() => CreateCategoryDto)
  categories?: CreateCategoryDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTRIBUTES_PER_STORE)
  @ValidateNested({ each: true })
  @Type(() => CreateAttributeDto)
  attributes?: CreateAttributeDto[];
}
