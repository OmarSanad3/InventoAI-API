import { IsString, MaxLength, MinLength } from 'class-validator';
import {
  BRAINSTORM_MAX_LENGTH,
  BRAINSTORM_MIN_LENGTH,
} from '../site-builder.constants';

export class BrainstormDto {
  @IsString()
  @MinLength(BRAINSTORM_MIN_LENGTH)
  @MaxLength(BRAINSTORM_MAX_LENGTH)
  brainstorm!: string;
}
