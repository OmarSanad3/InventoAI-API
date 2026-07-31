import { StoreTheme } from '../entities/store-theme.entity';
import { SpartanPreset } from '../enums/spartan-preset.enum';
import { ThemeFont } from '../enums/theme-font.enum';
import { Palette } from '../types/theme';
import { buildThemeCss } from '../utils/theme-css.util';
import { ThemeCssDto } from './theme-css.dto';

/**
 * Both shapes at once: the structured palette for a live preview, and the
 * derived CSS for dropping straight into a `<style>` tag.
 */
export class ThemeResponseDto {
  id!: string;
  name!: string;
  description!: string;
  style!: SpartanPreset;
  font!: ThemeFont;
  radius!: string;
  light!: Palette;
  dark!: Palette;
  isSelected!: boolean;
  css!: ThemeCssDto;

  static fromEntity(theme: StoreTheme): ThemeResponseDto {
    const dto = new ThemeResponseDto();
    dto.id = theme.id;
    dto.name = theme.name;
    dto.description = theme.description;
    dto.style = theme.style;
    dto.font = theme.font;
    dto.radius = theme.radius;
    dto.light = theme.light;
    dto.dark = theme.dark;
    dto.isSelected = theme.isSelected;
    dto.css = buildThemeCss(theme);
    return dto;
  }
}

export class ThemesResponseDto {
  themes!: ThemeResponseDto[];

  static fromEntities(themes: StoreTheme[]): ThemesResponseDto {
    const dto = new ThemesResponseDto();
    dto.themes = themes.map((theme) => ThemeResponseDto.fromEntity(theme));
    return dto;
  }
}
