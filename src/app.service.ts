import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppService {
  logger = new Logger(AppService.name);
  constructor(private readonly configService: ConfigService) {}

  getHello(): string {
    this.logger.debug(this.configService.get('PORT'));
    return 'Hello World!!!!';
  }
}
