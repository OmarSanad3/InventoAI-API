import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ToBoolean } from '../../common/transformers/to-boolean.transformer';
import {
  UNANSWERED_STATS_MAX_DAYS,
  UNANSWERED_WINDOW_DAYS,
} from '../chatbot.constants';

const MIN_DAYS = 1;

/** The window and the reviewed switch behind the demand feed. */
export class UnansweredQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_DAYS)
  @Max(UNANSWERED_STATS_MAX_DAYS)
  days: number = UNANSWERED_WINDOW_DAYS;

  /** Off by default: a reviewed theme has been dealt with and is noise. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeReviewed: boolean = false;
}

/** `/chat/stats` takes the same window and nothing else. */
export class ChatStatsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_DAYS)
  @Max(UNANSWERED_STATS_MAX_DAYS)
  days: number = UNANSWERED_WINDOW_DAYS;
}
