import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { IsSlug } from '../../common/validators/is-slug.decorator';
import {
  ATTRIBUTE_KEY_MAX_LENGTH,
  ATTRIBUTE_KEY_MIN_LENGTH,
  ATTRIBUTE_NAME_MAX_LENGTH,
  ATTRIBUTE_NAME_MIN_LENGTH,
} from '../catalog.constants';
import { AttributeDisplayStyle } from '../enums/attribute-display-style.enum';

/**
 * Every field optional; an omitted one is left alone.
 *
 * `isVariantAxis` is **absent on purpose**, so `forbidNonWhitelisted` 400s any
 * attempt to change it. Flipping it is a migration, not an edit: descriptive →
 * axis would need variants built retroactively with no correct answer for their
 * stock, and axis → descriptive would orphan every variant that exists only to
 * hold that axis. Changing it means deleting the attribute and creating a new
 * one, which forces the owner to confront what happens to their products.
 */
export class UpdateAttributeDto {
  @IsOptional()
  @IsString()
  @Length(ATTRIBUTE_NAME_MIN_LENGTH, ATTRIBUTE_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsSlug()
  @Length(ATTRIBUTE_KEY_MIN_LENGTH, ATTRIBUTE_KEY_MAX_LENGTH)
  key?: string;

  @IsOptional()
  @IsBoolean()
  isFilterable?: boolean;

  @IsOptional()
  @IsBoolean()
  showOnProductPage?: boolean;

  @IsOptional()
  @IsEnum(AttributeDisplayStyle)
  displayStyle?: AttributeDisplayStyle;
}
