import { IsString, Length } from 'class-validator';
import { MAX_REPLY_LENGTH } from '../suppliers.constants';

/**
 * What the supplier wrote back, pasted in whole — quoted thread and all. The
 * model reads it; nothing here parses it.
 */
export class SubmitReplyDto {
  @IsString()
  @Length(1, MAX_REPLY_LENGTH)
  body!: string;
}
