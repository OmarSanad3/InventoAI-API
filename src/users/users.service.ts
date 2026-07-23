import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { TokenService } from '../auth/token.service';
import { EnvironmentVariables } from '../config/env.validation';
import { MailService, OtpPurpose } from '../mail/mail.service';
import { RedisService } from '../redis/redis.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { LoginDto } from './dto/login.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TokenPairResponseDto } from './dto/token-pair-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';
import { BCRYPT_SALT_ROUNDS, OTP_LENGTH } from './users.constants';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly tokenService: TokenService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async registerOwner(dto: RegisterUserDto): Promise<RegisterResponseDto> {
    const user = await this.createUser(dto, UserRole.OWNER);
    return {
      message: 'Registration successful, please verify your email',
      user: UserResponseDto.fromEntity(user),
    };
  }

  async register(dto: RegisterUserDto): Promise<RegisterResponseDto> {
    const user = await this.createUser(dto, UserRole.USER);
    return {
      message: 'Registration successful, please verify your email',
      user: UserResponseDto.fromEntity(user),
    };
  }

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email: dto.email })
      .getOne();

    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isEmailVerified) {
      throw new ForbiddenException(
        'Please verify your email before logging in',
      );
    }

    const tokens = await this.tokenService.issueTokenPair(user);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: UserResponseDto.fromEntity(user),
    };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<MessageResponseDto> {
    const key = this.otpKey('verify-email', dto.email);
    const storedOtp = await this.redisService.get(key);
    if (!storedOtp || storedOtp !== dto.otp) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    const user = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (!user) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    user.isEmailVerified = true;
    await this.userRepository.save(user);
    await this.redisService.del(key);

    return { message: 'Email verified successfully' };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<MessageResponseDto> {
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (user) {
      await this.generateAndSendOtp('reset-password', user.email);
    }
    return {
      message:
        'If an account exists for that email, a reset code has been sent',
    };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<MessageResponseDto> {
    const key = this.otpKey('reset-password', dto.email);
    const storedOtp = await this.redisService.get(key);
    if (!storedOtp || storedOtp !== dto.otp) {
      throw new BadRequestException('Invalid or expired reset code');
    }

    const user = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (!user) {
      throw new BadRequestException('Invalid or expired reset code');
    }

    user.password = await bcrypt.hash(dto.newPassword, BCRYPT_SALT_ROUNDS);
    await this.userRepository.save(user);
    await this.redisService.del(key);

    return { message: 'Password reset successfully' };
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<MessageResponseDto> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.id = :id', { id: userId })
      .getOne();

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!(await bcrypt.compare(dto.oldPassword, user.password))) {
      throw new BadRequestException('Old password is incorrect');
    }

    user.password = await bcrypt.hash(dto.newPassword, BCRYPT_SALT_ROUNDS);
    await this.userRepository.save(user);

    return { message: 'Password changed successfully' };
  }

  async refreshToken(dto: RefreshTokenDto): Promise<TokenPairResponseDto> {
    return this.tokenService.rotateRefreshToken(dto.refreshToken);
  }

  private async createUser(
    dto: RegisterUserDto,
    role: UserRole,
  ): Promise<User> {
    const existing = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const user = this.userRepository.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      image: dto.image ?? null,
      password: await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS),
      role,
      isEmailVerified: false,
    });
    const saved = await this.userRepository.save(user);

    try {
      await this.generateAndSendOtp('verify-email', saved.email);
    } catch {
      // Roll back the account so a failed email doesn't leave an
      // unverifiable user that can never receive its OTP.
      await this.userRepository.delete({ id: saved.id });
      await this.redisService.del(this.otpKey('verify-email', saved.email));
      throw new ServiceUnavailableException(
        'Could not send verification email, please try again later',
      );
    }

    return saved;
  }

  private async generateAndSendOtp(
    purpose: OtpPurpose,
    email: string,
  ): Promise<void> {
    const otp = this.generateOtp();
    const ttl = this.configService.get('OTP_EXPIRES_IN_SECONDS', {
      infer: true,
    });
    await this.redisService.setex(this.otpKey(purpose, email), ttl, otp);
    await this.mailService.sendOtpEmail(email, otp, purpose);
  }

  private generateOtp(): string {
    const max = 10 ** OTP_LENGTH;
    return randomInt(0, max).toString().padStart(OTP_LENGTH, '0');
  }

  private otpKey(purpose: OtpPurpose, email: string): string {
    return `otp:${purpose}:${email}`;
  }
}
