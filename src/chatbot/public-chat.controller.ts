import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ChatAuthResolver } from './chat-auth.resolver';
import { ChatService } from './chat.service';
import { ChatReplyDto } from './dto/chat-reply.dto';
import { ChatTranscriptDto } from './dto/chat-transcript.dto';
import { SendMessageDto } from './dto/send-message.dto';

/**
 * The storefront's chat surface.
 *
 * Neither route carries `JwtAuthGuard`: a shopper is usually anonymous, and a
 * chatbot that demands a login is a chatbot nobody uses. `ChatAuthResolver` does
 * what the guard and `StoreScopeGuard` would have done, optionally — see its
 * doc comment for the three cases it distinguishes.
 */
@Controller('site/:slug/chat')
export class PublicChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly authResolver: ChatAuthResolver,
  ) {}

  /**
   * 200, not 201: a message is not a resource the client addresses afterwards,
   * and the session id it may have created is in the body.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Param('slug') slug: string,
    @Body() dto: SendMessageDto,
    @Req() request: Request,
  ): Promise<ChatReplyDto> {
    const store = await this.chatService.resolvePublicStore(slug);
    const user = await this.authResolver.resolve(request, store);

    // The rate limit is per caller, and a shopper with no account is only
    // identifiable by address. Behind a proxy this needs `trust proxy` set, or
    // every visitor shares the load balancer's IP and one bucket.
    const callerKey = user?.sub ?? request.ip ?? 'unknown';
    return this.chatService.sendMessage(slug, dto, user, store, callerKey);
  }

  /**
   * `sessionId` is a capability — whoever holds it can read the conversation.
   * That is fine while it is a stranger asking about mugs, and not fine once the
   * assistant has read an order's details back, so a session **bound to a user**
   * additionally requires that user's token.
   */
  @Get(':sessionId')
  async getTranscript(
    @Param('slug') slug: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Req() request: Request,
  ): Promise<ChatTranscriptDto> {
    const store = await this.chatService.resolvePublicStore(slug);
    const user = await this.authResolver.resolve(request, store);
    const { session, messages } = await this.chatService.getTranscript(
      store,
      sessionId,
    );

    if (session.userId) {
      if (!user) {
        throw new UnauthorizedException('Sign in to read this conversation');
      }
      if (user.sub !== session.userId) {
        throw new ForbiddenException(
          'This conversation belongs to someone else',
        );
      }
    }

    return ChatTranscriptDto.fromEntities(session, messages);
  }
}
