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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
