import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { IsNull, Repository } from 'typeorm';
import { TokenService } from '../auth/token.service';
import { EnvironmentVariables } from '../config/env.validation';
import { MailService, OtpPurpose } from '../mail/mail.service';
import { MailBrand } from '../mail/templates/otp-email.template';
import { RedisService } from '../redis/redis.service';
import { Store } from '../site-builder/entities/store.entity';
import { StoreService } from '../site-builder/store.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { LoginDto } from './dto/login.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { RegisterStoreUserDto } from './dto/register-store-user.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TokenPairResponseDto } from './dto/token-pair-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';
import {
  BCRYPT_SALT_ROUNDS,
  OTP_LENGTH,
  PLATFORM_BRAND_NAME,
  PLATFORM_OTP_SCOPE,
} from './users.constants';

interface CreateUserCommand {
  readonly dto: RegisterUserDto;
  readonly role: UserRole;
  readonly store: Store | null;
}

interface SendOtpCommand {
  readonly purpose: OtpPurpose;
  readonly email: string;
  readonly store: Store | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly tokenService: TokenService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly storeService: StoreService,
  ) {}

  async registerOwner(dto: RegisterUserDto): Promise<RegisterResponseDto> {
    const user = await this.createUser({
      dto,
      role: UserRole.OWNER,
      store: null,
    });
    return {
      message: 'Registration successful, please verify your email',
      user: UserResponseDto.fromEntity(user),
    };
  }

  async register(dto: RegisterStoreUserDto): Promise<RegisterResponseDto> {
    const store = await this.getStoreBySlug(dto.storeSlug);
    const user = await this.createUser({ dto, role: UserRole.USER, store });
    return {
      message: 'Registration successful, please verify your email',
      user: UserResponseDto.fromEntity(user),
    };
  }

  /** `storeSlug` omitted means a platform (OWNER) login. */
  async login(dto: LoginDto, storeSlug?: string): Promise<LoginResponseDto> {
    const store = await this.resolveStore(storeSlug);
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email: dto.email })
      .andWhere(
        store ? 'user.storeId = :storeId' : 'user.storeId IS NULL',
        store ? { storeId: store.id } : {},
      )
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

  async verifyEmail(
    dto: VerifyEmailDto,
    storeSlug?: string,
  ): Promise<MessageResponseDto> {
    const store = await this.resolveStore(storeSlug);
    const key = this.otpKey('verify-email', dto.email, store);
    const storedOtp = await this.redisService.get(key);
    if (!storedOtp || storedOtp !== dto.otp) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    const user = await this.findScopedUser(dto.email, store);
    if (!user) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    user.isEmailVerified = true;
    await this.userRepository.save(user);
    await this.redisService.del(key);

    return { message: 'Email verified successfully' };
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
    storeSlug?: string,
  ): Promise<MessageResponseDto> {
    const store = await this.resolveStore(storeSlug);
    const user = await this.findScopedUser(dto.email, store);
    if (user) {
      await this.generateAndSendOtp({
        purpose: 'reset-password',
        email: user.email,
        store,
      });
    }
    return {
      message:
        'If an account exists for that email, a reset code has been sent',
    };
  }

  async resetPassword(
    dto: ResetPasswordDto,
    storeSlug?: string,
  ): Promise<MessageResponseDto> {
    const store = await this.resolveStore(storeSlug);
    const key = this.otpKey('reset-password', dto.email, store);
    const storedOtp = await this.redisService.get(key);
    if (!storedOtp || storedOtp !== dto.otp) {
      throw new BadRequestException('Invalid or expired reset code');
    }

    const user = await this.findScopedUser(dto.email, store);
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

  /** Resolves an optional slug; `undefined` means a platform (OWNER) account. */
  private async resolveStore(slug?: string): Promise<Store | null> {
    return slug ? this.getStoreBySlug(slug) : null;
  }

  private async getStoreBySlug(slug: string): Promise<Store> {
    const store = await this.storeService.findBySlug(slug);
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return store;
  }

  /** Looks a user up within one store, or among platform accounts. */
  private async findScopedUser(
    email: string,
    store: Store | null,
  ): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email, storeId: store ? store.id : IsNull() },
    });
  }

  private async createUser({
    dto,
    role,
    store,
  }: CreateUserCommand): Promise<User> {
    const existing = await this.findScopedUser(dto.email, store);
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
      storeId: store ? store.id : null,
      isEmailVerified: false,
    });
    const saved = await this.userRepository.save(user);

    try {
      await this.generateAndSendOtp({
        purpose: 'verify-email',
        email: saved.email,
        store,
      });
    } catch {
      // Roll back the account so a failed email doesn't leave an
      // unverifiable user that can never receive its OTP.
      await this.userRepository.delete({ id: saved.id });
      await this.redisService.del(
        this.otpKey('verify-email', saved.email, store),
      );
      throw new ServiceUnavailableException(
        'Could not send verification email, please try again later',
      );
    }

    return saved;
  }

  private async generateAndSendOtp({
    purpose,
    email,
    store,
  }: SendOtpCommand): Promise<void> {
    const otp = this.generateOtp();
    const ttl = this.configService.get('OTP_EXPIRES_IN_SECONDS', {
      infer: true,
    });
    await this.redisService.setex(this.otpKey(purpose, email, store), ttl, otp);
    await this.mailService.sendOtpEmail({
      to: email,
      otp,
      purpose,
      brand: this.brandFor(store),
    });
  }

  /** The store brands its own users' mail; owners get the platform brand. */
  private brandFor(store: Store | null): MailBrand {
    if (!store) {
      return {
        name: PLATFORM_BRAND_NAME,
        logoUrl: this.configService.get('PLATFORM_LOGO_URL', { infer: true }),
      };
    }
    return { name: store.name, logoUrl: store.logoUrl };
  }

  private generateOtp(): string {
    const max = 10 ** OTP_LENGTH;
    return randomInt(0, max).toString().padStart(OTP_LENGTH, '0');
  }

  /** Scoped by store so two stores' codes for one address cannot collide. */
  private otpKey(
    purpose: OtpPurpose,
    email: string,
    store: Store | null,
  ): string {
    return `otp:${purpose}:${store ? store.id : PLATFORM_OTP_SCOPE}:${email}`;
  }
}
