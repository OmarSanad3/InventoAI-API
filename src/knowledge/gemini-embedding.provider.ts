import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { AI_UNAVAILABLE_MESSAGE } from '../ai/gemini.service';
import { EnvironmentVariables } from '../config/env.validation';
import { EmbeddingProvider } from './embedding.provider';
import {
  EMBED_BATCH_SIZE,
  EMBED_RETRY_BASE_DELAY_MS,
  EMBEDDING_DIMENSIONS,
  MAX_EMBED_ATTEMPTS,
} from './knowledge.constants';
import { normalizeVector } from './utils/normalize-vector.util';

/**
 * Indexing and searching use different task types on purpose. Gemini's
 * retrieval embeddings are asymmetric — a document and the query that should
 * find it are embedded into deliberately different points — and swapping them
 * costs recall without producing an error anywhere.
 */
const DOCUMENT_TASK_TYPE = 'RETRIEVAL_DOCUMENT';
const QUERY_TASK_TYPE = 'RETRIEVAL_QUERY';

/**
 * `gemini-embedding-001` over the `GEMINI_API_KEY` the project already
 * validates. It is multilingual, which matters more here than any benchmark
 * number: `SEARCH_TEXT_CONFIG` is `'english'`, so Arabic gets no stemming from
 * the lexical side, and embeddings are where "عباية سوداء" and "black abaya"
 * meet.
 */
@Injectable()
export class GeminiEmbeddingProvider
  implements EmbeddingProvider, OnModuleInit
{
  private readonly logger = new Logger(GeminiEmbeddingProvider.name);
  private client!: GoogleGenAI;

  readonly dimensions: number;
  readonly modelId: string;

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {
    this.dimensions = this.configService.get('EMBEDDING_DIMENSIONS', {
      infer: true,
    });
    this.modelId = this.configService.get('GEMINI_EMBEDDING_MODEL', {
      infer: true,
    });
  }

  onModuleInit(): void {
    this.client = new GoogleGenAI({
      apiKey: this.configService.get('GEMINI_API_KEY', { infer: true }),
    });

    // The schema, the config and the provider have to agree on one number. A
    // mismatch surfaces as an insert error per document rather than as anything
    // readable, so it is worth one loud line at boot.
    if (this.dimensions !== EMBEDDING_DIMENSIONS) {
      this.logger.error(
        `EMBEDDING_DIMENSIONS is ${this.dimensions} but the vector column is ${EMBEDDING_DIMENSIONS}; every write will fail`,
      );
    }
  }

  async embedDocuments(texts: readonly string[]): Promise<number[][]> {
    const vectors: number[][] = [];

    for (let index = 0; index < texts.length; index += EMBED_BATCH_SIZE) {
      const batch = texts.slice(index, index + EMBED_BATCH_SIZE);
      vectors.push(...(await this.embed(batch, DOCUMENT_TASK_TYPE)));
    }

    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embed([text], QUERY_TASK_TYPE);
    return vector;
  }

  /**
   * One call per batch, retried with backoff — a 429 on a free-tier key is a
   * wait, not a failure. Every vector is normalised to unit length before it
   * leaves: only the full 3072-width output arrives normalised, and a truncated
   * one that is not makes cosine distances incomparable between rows.
   */
  private async embed(
    texts: readonly string[],
    taskType: string,
  ): Promise<number[][]> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_EMBED_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.client.models.embedContent({
          model: this.modelId,
          contents: [...texts],
          config: { taskType, outputDimensionality: this.dimensions },
        });

        const embeddings = response.embeddings ?? [];
        if (embeddings.length !== texts.length) {
          throw new Error(
            `expected ${texts.length} embeddings, received ${embeddings.length}`,
          );
        }

        return embeddings.map((embedding) => {
          if (!embedding.values?.length) {
            throw new Error('an embedding came back empty');
          }
          return normalizeVector(embedding.values);
        });
      } catch (err) {
        lastError = err;
        if (attempt < MAX_EMBED_ATTEMPTS) {
          await delay(EMBED_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }

    this.logger.error(
      `Embedding failed after ${MAX_EMBED_ATTEMPTS} attempts: ${String(lastError)}`,
    );
    throw new ServiceUnavailableException(AI_UNAVAILABLE_MESSAGE);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
