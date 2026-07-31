import { Type as TransformType } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SpartanPreset } from '../enums/spartan-preset.enum';
import { ThemeFont } from '../enums/theme-font.enum';
import { RADIUS_PATTERN } from '../site-builder.constants';
import { Theme } from '../types/theme';
import { PaletteDto } from './palette.dto';

const MAX_NAME_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 240;

/**
 * The contract Gemini's output has to satisfy before it is persisted. This is
 * not a request DTO — it is validated by hand in the theme service, so a
 * malformed suggestion is dropped instead of failing the whole batch.
 */
export class GeneratedThemeDto implements Theme {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description!: string;

  @IsEnum(SpartanPreset)
  style!: SpartanPreset;

  @IsEnum(ThemeFont)
  font!: ThemeFont;

  @Matches(RADIUS_PATTERN, {
    message: 'radius must be a CSS length such as 0.5rem',
  })
  radius!: string;

  @ValidateNested()
  @TransformType(() => PaletteDto)
  light!: PaletteDto;

  @ValidateNested()
  @TransformType(() => PaletteDto)
  dark!: PaletteDto;
}
