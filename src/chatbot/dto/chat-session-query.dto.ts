import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ToBoolean } from '../../common/transformers/to-boolean.transformer';

const SEARCH_MAX_LENGTH = 200;

/** Filters for the dashboard's transcript list, newest activity first. */
export class ChatSessionQueryDto extends PaginationQueryDto {
  /**
   * `ILIKE` over the messages of the conversation, both halves of it.
   *
   * The same call [orders.md] made about its own search: the catalog's
   * full-text stack is for *discovering* products, and an owner reading
   * transcripts already knows the phrase they are looking for.
   */
  @IsOptional()
  @IsString()
  @Length(0, SEARCH_MAX_LENGTH)
  search?: string;

  /** Inclusive, on `lastMessageAt` — activity in the window, not creation. */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /** Conversations that left the assistant with nothing to say. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  hasUnanswered?: boolean;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isSignedIn?: boolean;
}
