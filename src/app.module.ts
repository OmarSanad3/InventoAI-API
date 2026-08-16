import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { validate } from './config/env.validation';
import { RedisModule } from './redis/redis.module';
import { MailModule } from './mail/mail.module';
import { UsersModule } from './users/users.module';
import { AiModule } from './ai/ai.module';
import { StorageModule } from './storage/storage.module';
import { SiteBuilderModule } from './site-builder/site-builder.module';
import { CatalogModule } from './catalog/catalog.module';
import { FaqModule } from './faq/faq.module';
import { OrdersModule } from './orders/orders.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { ChatbotModule } from './chatbot/chatbot.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    // The project's first scheduler. The knowledge base's sweeper needs it, and
    // the Daily AI Advisor will need the same thing.
    ScheduleModule.forRoot(),
    DatabaseModule,
    RedisModule,
    MailModule,
    AiModule,
    StorageModule,
    UsersModule,
    SiteBuilderModule,
    CatalogModule,
    FaqModule,
    OrdersModule,
    KnowledgeModule,
    ChatbotModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
