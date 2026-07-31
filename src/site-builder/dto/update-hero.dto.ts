import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  MAX_HERO_CTA_HREF_LENGTH,
  MAX_HERO_CTA_LABEL_LENGTH,
  MAX_HERO_HEADLINE_LENGTH,
  MAX_HERO_SUBTITLE_LENGTH,
} from '../site-builder.constants';

/**
 * Every field is optional: an omitted field is left alone, an empty string
 * clears it. The image itself is the `image` file part of the same request.
 */
export class UpdateHeroDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_HERO_HEADLINE_LENGTH)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_HERO_SUBTITLE_LENGTH)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_HERO_CTA_LABEL_LENGTH)
  ctaLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_HERO_CTA_HREF_LENGTH)
  ctaHref?: string;
}
