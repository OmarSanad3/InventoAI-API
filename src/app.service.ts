import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from './config/env.validation';

@Injectable()
export class AppService {
  logger = new Logger(AppService.name);
  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  getHello(): string {
    this.logger.debug(this.configService.get('PORT', { infer: true }));
    return 'Hello World!!!!';
  }
}
