import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { GoogleTokenVerifier } from './google-token.verifier';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TokenService } from './token.service';
import { SiteBuilderModule } from '../site-builder/site-builder.module';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([User]),
    forwardRef(() => SiteBuilderModule),
  ],
  providers: [TokenService, JwtAuthGuard, GoogleTokenVerifier],
  exports: [TokenService, JwtAuthGuard, GoogleTokenVerifier],
})
export class AuthModule {}
