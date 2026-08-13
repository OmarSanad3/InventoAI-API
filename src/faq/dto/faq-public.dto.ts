import { Faq } from '../entities/faq.entity';

/**
 * What a shopper sees. Only the pair itself — a storefront FAQ page renders the
 * list in the order it arrives, so it needs neither the id nor the position.
 */
export class FaqPublicDto {
  question!: string;
  answer!: string;

  static fromEntity(faq: Faq): FaqPublicDto {
    const dto = new FaqPublicDto();
    dto.question = faq.question;
    dto.answer = faq.answer;
    return dto;
  }
}
