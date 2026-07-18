import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { validate } from './config/env.validation';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate }), DatabaseModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
