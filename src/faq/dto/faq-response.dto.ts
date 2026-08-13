import { Faq } from '../entities/faq.entity';

/**
 * The dashboard's view of an FAQ entry. `storeId` is omitted: the caller
 * already knows their store, and exposing it only invites the mistake of
 * accepting it back on write.
 */
export class FaqResponseDto {
  id!: string;
  question!: string;
  answer!: string;
  position!: number;
  isPublished!: boolean;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(faq: Faq): FaqResponseDto {
    const dto = new FaqResponseDto();
    dto.id = faq.id;
    dto.question = faq.question;
    dto.answer = faq.answer;
    dto.position = faq.position;
    dto.isPublished = faq.isPublished;
    dto.createdAt = faq.createdAt;
    dto.updatedAt = faq.updatedAt;
    return dto;
  }
}
