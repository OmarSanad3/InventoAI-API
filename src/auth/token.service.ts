import { createHash, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EnvironmentVariables } from '../config/env.validation';
import { RedisService } from '../redis/redis.service';
import { TokenPairResponseDto } from '../users/dto/token-pair-response.dto';
import { User } from '../users/entities/user.entity';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly redisService: RedisService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async issueTokenPair(user: User): Promise<TokenPairResponseDto> {
    const basePayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      storeId: user.storeId,
    };

    const accessToken = this.jwtService.sign(basePayload, {
      secret: this.configService.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.configService.get('JWT_ACCESS_EXPIRES_IN', {
        infer: true,
      }),
    });

    const jti = randomUUID();
    const refreshToken = this.jwtService.sign(
      { ...basePayload, jti },
      {
        secret: this.configService.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', {
          infer: true,
        }),
      },
    );

    await this.storeRefreshToken(user.id, jti, refreshToken);

    return { accessToken, refreshToken };
  }

  async verifyAccessToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get('JWT_ACCESS_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  async rotateRefreshToken(rawToken: string): Promise<TokenPairResponseDto> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(rawToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (!payload.jti) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const redisKey = this.refreshKey(payload.sub, payload.jti);
    const storedHash = await this.redisService.get(redisKey);
    if (!storedHash || storedHash !== this.hashToken(rawToken)) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.redisService.del(redisKey);

    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return this.issueTokenPair(user);
  }

  private async storeRefreshToken(
    userId: string,
    jti: string,
    rawToken: string,
  ): Promise<void> {
    const decoded = this.jwtService.decode<{ exp?: number } | null>(rawToken);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttlSeconds =
      decoded?.exp && decoded.exp > nowSeconds ? decoded.exp - nowSeconds : 0;
    if (ttlSeconds <= 0) {
      return;
    }
    await this.redisService.setex(
      this.refreshKey(userId, jti),
      ttlSeconds,
      this.hashToken(rawToken),
    );
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshKey(userId: string, jti: string): string {
    return `refresh:${userId}:${jti}`;
  }
}
