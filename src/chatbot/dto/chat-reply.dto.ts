import { ProductPublicListItemDto } from '../../catalog/dto/product-public-list-item.dto';
import { OrderListItemDto } from '../../orders/dto/order-list-item.dto';
import { ChatResolution } from '../enums/chat-resolution.enum';

export class FaqCitationDto {
  id!: string;
  question!: string;
}

export class ChatMessageDto {
  id!: string;
  text!: string;
  createdAt!: Date;
}

/**
 * A reply is a message **and a payload**.
 *
 * `products` is the storefront's own card DTO, not a chat-shaped copy, so a card
 * in the bubble and a card on the listing page are the same object. It is built
 * from ids against live rows — the frontend renders from it and must never parse
 * a price out of `message.text`, which is the one number a model can get wrong.
 */
export class ChatReplyDto {
  sessionId!: string;
  message!: ChatMessageDto;
  resolution!: ChatResolution;
  products!: ProductPublicListItemDto[];
  faqs!: FaqCitationDto[];
  order!: OrderListItemDto | null;

  /** True exactly when `resolution` is `needs_login`. Hang the sign-in button off it. */
  requiresLogin!: boolean;
}
