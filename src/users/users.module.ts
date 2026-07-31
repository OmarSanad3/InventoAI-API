import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { SiteBuilderModule } from '../site-builder/site-builder.module';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule, SiteBuilderModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
