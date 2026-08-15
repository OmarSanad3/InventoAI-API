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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
