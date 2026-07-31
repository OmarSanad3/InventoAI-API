import { IsOklchColor } from '../../common/validators/is-oklch-color.decorator';
import { Palette } from '../types/theme';

/**
 * Validates one scheme of an AI-generated palette. `implements Palette` is what
 * keeps this list in step with `PALETTE_KEYS` — dropping a token stops compiling.
 */
export class PaletteDto implements Palette {
  @IsOklchColor()
  background!: string;

  @IsOklchColor()
  foreground!: string;

  @IsOklchColor()
  card!: string;

  @IsOklchColor()
  cardForeground!: string;

  @IsOklchColor()
  popover!: string;

  @IsOklchColor()
  popoverForeground!: string;

  @IsOklchColor()
  primary!: string;

  @IsOklchColor()
  primaryForeground!: string;

  @IsOklchColor()
  secondary!: string;

  @IsOklchColor()
  secondaryForeground!: string;

  @IsOklchColor()
  muted!: string;

  @IsOklchColor()
  mutedForeground!: string;

  @IsOklchColor()
  accent!: string;

  @IsOklchColor()
  accentForeground!: string;

  @IsOklchColor()
  destructive!: string;

  @IsOklchColor()
  border!: string;

  @IsOklchColor()
  input!: string;

  @IsOklchColor()
  ring!: string;

  @IsOklchColor()
  chart1!: string;

  @IsOklchColor()
  chart2!: string;

  @IsOklchColor()
  chart3!: string;

  @IsOklchColor()
  chart4!: string;

  @IsOklchColor()
  chart5!: string;
}
