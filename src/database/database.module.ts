import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Environment, EnvironmentVariables } from '../config/env.validation';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (
        configService: ConfigService<EnvironmentVariables, true>,
      ) => ({
        type: 'postgres',
        host: configService.get('DATABASE_HOST', { infer: true }),
        port: configService.get('DATABASE_PORT', { infer: true }),
        username: configService.get('DATABASE_USER', { infer: true }),
        password: configService.get('DATABASE_PASSWORD', { infer: true }),
        database: configService.get('DATABASE_NAME', { infer: true }),
        autoLoadEntities: true,
        synchronize:
          configService.get('NODE_ENV', { infer: true }) ===
          Environment.Development,
      }),
    }),
  ],
})
export class DatabaseModule {}
