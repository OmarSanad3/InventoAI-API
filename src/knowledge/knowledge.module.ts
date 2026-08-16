import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { Category } from '../catalog/entities/category.entity';
import { Product } from '../catalog/entities/product.entity';
import { RolesGuard } from '../common/guards/roles.guard';
import { Faq } from '../faq/entities/faq.entity';
import { Store } from '../site-builder/entities/store.entity';
import { SiteBuilderModule } from '../site-builder/site-builder.module';
import { EMBEDDING_PROVIDER } from './embedding.provider';
import { KnowledgeDocument } from './entities/knowledge-document.entity';
import { GeminiEmbeddingProvider } from './gemini-embedding.provider';
import { KnowledgeComposer } from './knowledge-composer.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeIndexer } from './knowledge-indexer.service';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeSubscriber } from './knowledge.subscriber';
import { KnowledgeSweeper } from './knowledge-sweeper.service';
import { KnowledgeVectorInitializer } from './knowledge-vector.initializer';
import { RetrievalService } from './retrieval.service';

/**
 * The retrieval half of the chatbot epic, kept apart from the conversation on
 * purpose: this is a search service over the catalog and the FAQ that the
 * Advisor will want too, while the chatbot is a conversation. `ChatbotModule`
 * will import this; nothing here reaches back.
 *
 * No `forwardRef` in either direction — the catalog and the FAQ know nothing
 * about a knowledge document. `Product`, `Category`, `Faq` and `Store` are
 * registered for their repositories only; the rules that own them stay in their
 * own modules.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      KnowledgeDocument,
      Product,
      Category,
      Faq,
      Store,
    ]),
    AuthModule,
    CatalogModule,
    SiteBuilderModule,
  ],
  controllers: [KnowledgeController],
  providers: [
    { provide: EMBEDDING_PROVIDER, useClass: GeminiEmbeddingProvider },
    KnowledgeComposer,
    KnowledgeIndexer,
    KnowledgeService,
    KnowledgeSubscriber,
    KnowledgeSweeper,
    KnowledgeVectorInitializer,
    RetrievalService,
    RolesGuard,
  ],
  // `EMBEDDING_PROVIDER` is exported for the chatbot's unanswered clustering,
  // which embeds question themes rather than documents. The port is the seam
  // that makes that possible without a second model or a second key.
  exports: [EMBEDDING_PROVIDER, KnowledgeIndexer, RetrievalService],
})
export class KnowledgeModule {}
