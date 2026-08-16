import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { FaqModule } from '../faq/faq.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { OrdersModule } from '../orders/orders.module';
import { SiteBuilderModule } from '../site-builder/site-builder.module';
import { ChatAuthResolver } from './chat-auth.resolver';
import { ChatClusteringService } from './chat-clustering.service';
import { ChatFinalizer } from './chat-finalizer.service';
import { ChatInsightsController } from './chat-insights.controller';
import { ChatInsightsService } from './chat-insights.service';
import { ChatMaintenanceService } from './chat-maintenance.service';
import { ChatService } from './chat.service';
import { ChatbotSettingsService } from './chatbot-settings.service';
import { ChatToolsFactory } from './tools/chat-tools.factory';
import { ChatAgentFactory } from './graph/chat-agent.factory';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSession } from './entities/chat-session.entity';
import { ChatbotSettings } from './entities/chatbot-settings.entity';
import { PublicChatController } from './public-chat.controller';

/**
 * The conversation half of the chatbot epic, plus the owner's window onto it.
 * It imports `KnowledgeModule` for retrieval and for the embedding provider the
 * nightly clustering pass uses; nothing there reaches back.
 *
 * Everything the tools call is an existing service of an existing module —
 * that is the point of the layout, and it is why this module owns three
 * entities and no business rule about products, FAQ entries or orders.
 *
 * `ChatInsightsService` is exported for the Daily AI Advisor, which is meant to
 * read the unanswered feed through `listUnansweredThemes` and never to touch
 * `ChatMessage` itself.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ChatSession, ChatMessage, ChatbotSettings]),
    AuthModule,
    SiteBuilderModule,
    KnowledgeModule,
    CatalogModule,
    FaqModule,
    OrdersModule,
  ],
  controllers: [PublicChatController, ChatInsightsController],
  providers: [
    ChatAgentFactory,
    ChatAuthResolver,
    ChatClusteringService,
    ChatFinalizer,
    ChatInsightsService,
    ChatMaintenanceService,
    ChatService,
    ChatToolsFactory,
    ChatbotSettingsService,
  ],
  exports: [ChatService, ChatInsightsService],
})
export class ChatbotModule {}
