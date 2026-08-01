import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class CategoryPositionDto {
  @IsUUID()
  id!: string;

  @IsInt()
  @Min(0)
  position!: number;
}

/** The whole re-ordered list, applied in one transaction. */
export class ReorderCategoriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CategoryPositionDto)
  items!: CategoryPositionDto[];
}
