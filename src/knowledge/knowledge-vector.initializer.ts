import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  EMBEDDING_DIMENSIONS,
  KNOWLEDGE_EMBEDDINGS_TABLE,
} from './knowledge.constants';

/**
 * The vector half of the knowledge base, in the one place `synchronize` cannot
 * reach: an extension it does not create, a column type it does not know, and an
 * index type its `@Index` has no `USING` for.
 *
 * The table is deliberately **unmanaged by TypeORM**. `synchronize` drops
 * columns it does not recognise from tables it owns, but it never touches a
 * table it has never heard of — so declaring the vector here rather than on
 * `KnowledgeDocument` is what lets it survive every boot.
 *
 * **A `synchronize`-era stopgap**, exactly like `CatalogSearchInitializer`: when
 * migrations land these statements become a migration and this class is deleted.
 * Nothing else belongs in it.
 *
 * Every statement is `IF NOT EXISTS`, so running on every boot is free. A
 * refused `CREATE EXTENSION` — a managed Postgres where the app's role is not
 * superuser — is logged and swallowed: retrieval falls back to lexical only, and
 * the application still starts.
 */
@Injectable()
export class KnowledgeVectorInitializer implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeVectorInitializer.name);

  /** Read by `GET /knowledge/status`, so an owner can see why answers got worse. */
  private isVectorSearchAvailable = false;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    this.isVectorSearchAvailable = await this.runAll([
      'CREATE EXTENSION IF NOT EXISTS vector',
      `CREATE TABLE IF NOT EXISTS "${KNOWLEDGE_EMBEDDINGS_TABLE}" (
         "documentId" uuid PRIMARY KEY
           REFERENCES knowledge_documents(id) ON DELETE CASCADE,
         embedding vector(${EMBEDDING_DIMENSIONS}) NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS "IDX_knowledge_embeddings_hnsw"
         ON "${KNOWLEDGE_EMBEDDINGS_TABLE}" USING hnsw (embedding vector_cosine_ops)`,
    ]);

    if (!this.isVectorSearchAvailable) {
      this.logger.warn(
        'pgvector is unavailable; the knowledge base will retrieve lexically only',
      );
    }
  }

  hasVectorSearch(): boolean {
    return this.isVectorSearchAvailable;
  }

  private async runAll(statements: readonly string[]): Promise<boolean> {
    for (const statement of statements) {
      try {
        await this.dataSource.query(statement);
      } catch (err) {
        this.logger.warn(`Knowledge vector bootstrap skipped: ${String(err)}`);
        return false;
      }
    }
    return true;
  }
}
