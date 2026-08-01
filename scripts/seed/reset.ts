import { DataSource } from 'typeorm';
import { RedisService } from '../../src/redis/redis.service';

/** Ephemeral key namespaces this app owns. Never `FLUSHDB` — see below. */
const OWNED_KEY_PATTERNS = ['refresh:*', 'otp:*'] as const;

/**
 * Empties every table TypeORM knows about.
 *
 * The list is derived from `entityMetadatas` rather than hardcoded, so an
 * entity added by a later branch is cleared automatically and this file never
 * goes stale. `CASCADE` covers the join tables and the FK order.
 */
export async function resetDatabase(dataSource: DataSource): Promise<number> {
  const tables = dataSource.entityMetadatas.map(
    (metadata) => `"${metadata.tableName}"`,
  );
  if (tables.length === 0) {
    return 0;
  }

  await dataSource.query(
    `TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`,
  );
  return tables.length;
}

/**
 * Clears only the keys this app writes.
 *
 * Deliberately not `FLUSHDB`: the Redis on 6379 may be a shared local instance
 * rather than the one in `docker-compose.yml`, and wiping someone's unrelated
 * data to reseed a dev catalog is not a trade worth making.
 */
export async function resetRedis(redisService: RedisService): Promise<number> {
  let deleted = 0;
  for (const pattern of OWNED_KEY_PATTERNS) {
    deleted += await redisService.deleteByPattern(pattern);
  }
  return deleted;
}
