import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { IsSlug } from '../../common/validators/is-slug.decorator';
import {
  ATTRIBUTE_KEY_MAX_LENGTH,
  ATTRIBUTE_KEY_MIN_LENGTH,
  ATTRIBUTE_NAME_MAX_LENGTH,
  ATTRIBUTE_NAME_MIN_LENGTH,
  MAX_VALUES_PER_ATTRIBUTE,
} from '../catalog.constants';
import { AttributeDisplayStyle } from '../enums/attribute-display-style.enum';
import { CreateAttributeValueDto } from './create-attribute-value.dto';

/**
 * There is deliberately no `storeId`: `forbidNonWhitelisted` then turns any
 * attempt to send one into a 400, and the store always comes from the JWT.
 */
export class CreateAttributeDto {
  @IsString()
  @Length(ATTRIBUTE_NAME_MIN_LENGTH, ATTRIBUTE_NAME_MAX_LENGTH)
  name!: string;

  /** Omitted means "derive it from the name". */
  @IsOptional()
  @IsSlug()
  @Length(ATTRIBUTE_KEY_MIN_LENGTH, ATTRIBUTE_KEY_MAX_LENGTH)
  key?: string;

  /** Accepted only here — see `UpdateAttributeDto` for why. */
  @IsOptional()
  @IsBoolean()
  isVariantAxis?: boolean;

  @IsOptional()
  @IsBoolean()
  isFilterable?: boolean;

  @IsOptional()
  @IsBoolean()
  showOnProductPage?: boolean;

  @IsOptional()
  @IsEnum(AttributeDisplayStyle)
  displayStyle?: AttributeDisplayStyle;

  /** A convenience: define "Size" with S/M/L in one request, not four. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_VALUES_PER_ATTRIBUTE)
  @ValidateNested({ each: true })
  @Type(() => CreateAttributeValueDto)
  values?: CreateAttributeValueDto[];
}
