import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * `pg_trgm` gives the trigram similarity the typo fallback runs on. `btree_gin`
 * is what lets `storeId` sit *inside* the GIN index, so a store's search is one
 * index scan rather than a full-text scan bitmap-ANDed against a tenant filter —
 * and multi-tenant search is the entire workload here.
 *
 * Both ship with the `postgres:15-alpine` image in docker-compose.yml.
 */
const EXTENSIONS: readonly string[] = [
  'CREATE EXTENSION IF NOT EXISTS pg_trgm',
  'CREATE EXTENSION IF NOT EXISTS btree_gin',
];

const INDEXES: readonly string[] = [
  `CREATE INDEX IF NOT EXISTS "IDX_products_search"
     ON products USING GIN ("storeId", "searchVector")`,
  `CREATE INDEX IF NOT EXISTS "IDX_products_title_trgm"
     ON products USING GIN (title gin_trgm_ops)`,
];

/**
 * Creates the extensions and GIN indexes `synchronize` cannot express —
 * TypeORM's `@Index` has no `USING` option, and `synchronize` creates no
 * extensions at all.
 *
 * **A `synchronize`-era stopgap.** When migrations land this becomes one
 * migration and the class is deleted; nothing else should be added to it.
 *
 * Every statement is `IF NOT EXISTS`, so running it on every boot is free. A
 * refused `CREATE EXTENSION` — a managed Postgres where the app's role is not
 * superuser — is logged and swallowed: search degrades, the application still
 * starts.
 */
@Injectable()
export class CatalogSearchInitializer implements OnModuleInit {
  private readonly logger = new Logger(CatalogSearchInitializer.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    const hasExtensions = await this.runAll(EXTENSIONS);
    if (!hasExtensions) {
      this.logger.warn(
        'Search extensions are missing; typo tolerance and the tenant-scoped GIN index are unavailable',
      );
      return;
    }
    await this.runAll(INDEXES);
  }

  private async runAll(statements: readonly string[]): Promise<boolean> {
    for (const statement of statements) {
      try {
        await this.dataSource.query(statement);
      } catch (err) {
        this.logger.warn(`Catalog search bootstrap skipped: ${String(err)}`);
        return false;
      }
    }
    return true;
  }
}
