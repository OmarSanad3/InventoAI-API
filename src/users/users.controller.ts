import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { GoogleStoreLoginDto } from './dto/google-store-login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { LoginDto } from './dto/login.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { RegisterStoreUserDto } from './dto/register-store-user.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { StoreForgotPasswordDto } from './dto/store-forgot-password.dto';
import { StoreLoginDto } from './dto/store-login.dto';
import { StoreResendVerificationDto } from './dto/store-resend-verification.dto';
import { StoreResetPasswordDto } from './dto/store-reset-password.dto';
import { StoreVerifyEmailDto } from './dto/store-verify-email.dto';
import { TokenPairResponseDto } from './dto/token-pair-response.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { UserRole } from './enums/user-role.enum';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('register/owner')
  registerOwner(@Body() dto: RegisterUserDto): Promise<RegisterResponseDto> {
    return this.usersService.registerOwner(dto);
  }

  @Post('register')
  register(@Body() dto: RegisterStoreUserDto): Promise<RegisterResponseDto> {
    return this.usersService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: StoreLoginDto): Promise<LoginResponseDto> {
    return this.usersService.login(dto, dto.storeSlug);
  }

  @Post('login/owner')
  @HttpCode(HttpStatus.OK)
  loginOwner(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.usersService.login(dto);
  }

  // 200 rather than 201 on both: the caller cannot know in advance whether this
  // is a signup or a login, and neither can the status code sensibly.
  @Post('google')
  @HttpCode(HttpStatus.OK)
  signInWithGoogle(
    @Body() dto: GoogleStoreLoginDto,
  ): Promise<LoginResponseDto> {
    return this.usersService.signInWithGoogle({
      idToken: dto.idToken,
      role: UserRole.USER,
      storeSlug: dto.storeSlug,
    });
  }

  @Post('google/owner')
  @HttpCode(HttpStatus.OK)
  signInOwnerWithGoogle(
    @Body() dto: GoogleLoginDto,
  ): Promise<LoginResponseDto> {
    return this.usersService.signInWithGoogle({
      idToken: dto.idToken,
      role: UserRole.OWNER,
    });
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: StoreVerifyEmailDto): Promise<MessageResponseDto> {
    return this.usersService.verifyEmail(dto, dto.storeSlug);
  }

  @Post('verify-email/owner')
  @HttpCode(HttpStatus.OK)
  verifyOwnerEmail(@Body() dto: VerifyEmailDto): Promise<MessageResponseDto> {
    return this.usersService.verifyEmail(dto);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  resendVerification(
    @Body() dto: StoreResendVerificationDto,
  ): Promise<MessageResponseDto> {
    return this.usersService.resendVerification(dto, dto.storeSlug);
  }

  @Post('resend-verification/owner')
  @HttpCode(HttpStatus.OK)
  resendOwnerVerification(
    @Body() dto: ResendVerificationDto,
  ): Promise<MessageResponseDto> {
    return this.usersService.resendVerification(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(
    @Body() dto: StoreForgotPasswordDto,
  ): Promise<MessageResponseDto> {
    return this.usersService.forgotPassword(dto, dto.storeSlug);
  }

  @Post('forgot-password/owner')
  @HttpCode(HttpStatus.OK)
  forgotOwnerPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<MessageResponseDto> {
    return this.usersService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @Body() dto: StoreResetPasswordDto,
  ): Promise<MessageResponseDto> {
    return this.usersService.resetPassword(dto, dto.storeSlug);
  }

  @Post('reset-password/owner')
  @HttpCode(HttpStatus.OK)
  resetOwnerPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<MessageResponseDto> {
    return this.usersService.resetPassword(dto);
  }

  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  refreshToken(@Body() dto: RefreshTokenDto): Promise<TokenPairResponseDto> {
    return this.usersService.refreshToken(dto);
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ): Promise<MessageResponseDto> {
    return this.usersService.changePassword(user.sub, dto);
  }
}
