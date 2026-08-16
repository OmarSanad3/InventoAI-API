import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { EnvironmentVariables } from '../config/env.validation';

/** Keys per `SCAN` round-trip; a hint, not a limit. */
const SCAN_BATCH_SIZE = 100;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  onModuleInit(): void {
    this.client = new Redis({
      host: this.configService.get('REDIS_HOST', { infer: true }),
      port: this.configService.get('REDIS_PORT', { infer: true }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async setex(key: string, seconds: number, value: string): Promise<void> {
    await this.client.setex(key, seconds, value);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Increments a counter and returns its new value, setting the expiry only on
   * the first increment — so the window starts with the first request in it
   * rather than sliding forward with every one. A token bucket, in other words.
   */
  async increment(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, ttlSeconds);
    }
    return count;
  }

  /**
   * `SET key value NX EX seconds` — writes only if the key is absent, and
   * reports whether it won. A lock, in other words: one instance sweeps and the
   * others skip, rather than every instance embedding the same batch.
   */
  async setIfAbsent(
    key: string,
    value: string,
    seconds: number,
  ): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', seconds, 'NX');
    return result === 'OK';
  }

  /**
   * Seconds left on a key, or `0` when it is missing or has no expiry — so a
   * cooldown message can name the wait instead of saying "later".
   */
  async ttl(key: string): Promise<number> {
    const seconds = await this.client.ttl(key);
    return seconds > 0 ? seconds : 0;
  }

  /**
   * Deletes every key matching a glob pattern, e.g. `refresh:<userId>:*`.
   *
   * Uses `SCAN` rather than `KEYS`, which blocks the server for the whole sweep,
   * and never `FLUSHDB` — the instance may not be ours alone.
   */
  async deleteByPattern(pattern: string): Promise<number> {
    let cursor = '0';
    let deleted = 0;

    do {
      const [next, keys] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        SCAN_BATCH_SIZE,
      );
      cursor = next;
      if (keys.length > 0) {
        deleted += await this.client.del(...keys);
      }
    } while (cursor !== '0');

    return deleted;
  }
}
