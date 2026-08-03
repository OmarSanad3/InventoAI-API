import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class PositionItemDto {
  @IsUUID()
  id!: string;

  @IsInt()
  @Min(0)
  position!: number;
}

/**
 * The whole re-ordered list, validated wholesale and applied in one
 * transaction — a partial reorder is worse than a rejected one.
 */
export class ReorderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PositionItemDto)
  items!: PositionItemDto[];
}
