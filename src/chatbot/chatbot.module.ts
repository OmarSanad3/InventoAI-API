import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { FaqModule } from '../faq/faq.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { OrdersModule } from '../orders/orders.module';
import { SiteBuilderModule } from '../site-builder/site-builder.module';
import { ChatAuthResolver } from './chat-auth.resolver';
import { ChatFinalizer } from './chat-finalizer.service';
import { ChatService } from './chat.service';
import { ChatToolsFactory } from './tools/chat-tools.factory';
import { ChatAgentFactory } from './graph/chat-agent.factory';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSession } from './entities/chat-session.entity';
import { PublicChatController } from './public-chat.controller';

/**
 * The conversation half of the chatbot epic. It imports `KnowledgeModule` for
 * retrieval; nothing there reaches back.
 *
 * Everything the tools call is an existing service of an existing module —
 * that is the point of the layout, and it is why this module owns two entities
 * and no business rule about products, FAQ entries or orders.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ChatSession, ChatMessage]),
    AuthModule,
    SiteBuilderModule,
    KnowledgeModule,
    CatalogModule,
    FaqModule,
    OrdersModule,
  ],
  controllers: [PublicChatController],
  providers: [
    ChatAgentFactory,
    ChatAuthResolver,
    ChatFinalizer,
    ChatService,
    ChatToolsFactory,
  ],
  exports: [ChatService],
})
export class ChatbotModule {}
