import { SpartanPreset } from '../enums/spartan-preset.enum';

/** The shape the Angular client drops straight into a `<style>` tag. */
export class ThemeCssDto {
  basePreset!: SpartanPreset;
  name!: string;
  description!: string;
  rawCss!: string;
}
