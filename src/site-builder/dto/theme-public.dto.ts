import { StoreTheme } from '../entities/store-theme.entity';
import { SpartanPreset } from '../enums/spartan-preset.enum';
import { ThemeFont } from '../enums/theme-font.enum';
import type { Palette } from '../types/theme';

/**
 * The stored theme exactly as the storefront consumes it — the same structured
 * shape that lives in the database, not the derived CSS.
 */
export class ThemePublicDto {
  font!: ThemeFont;
  radius!: string;
  light!: Palette;
  dark!: Palette;
  style!: SpartanPreset;

  static fromEntity(theme: StoreTheme): ThemePublicDto {
    const dto = new ThemePublicDto();
    dto.font = theme.font;
    dto.radius = theme.radius;
    dto.light = theme.light;
    dto.dark = theme.dark;
    dto.style = theme.style;
    return dto;
  }
}
