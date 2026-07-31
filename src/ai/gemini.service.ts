import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Schema } from '@google/genai';
import { EnvironmentVariables } from '../config/env.validation';

export interface GenerateJsonOptions {
  readonly prompt: string;
  readonly schema: Schema;
  readonly temperature?: number;
}

const DEFAULT_TEMPERATURE = 0.9;

@Injectable()
export class GeminiService implements OnModuleInit {
  private readonly logger = new Logger(GeminiService.name);
  private client!: GoogleGenAI;
  private model!: string;

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  onModuleInit(): void {
    this.client = new GoogleGenAI({
      apiKey: this.configService.get('GEMINI_API_KEY', { infer: true }),
    });
    this.model = this.configService.get('GEMINI_MODEL', { infer: true });
  }

  /**
   * Asks Gemini for JSON matching `schema` and parses it. The schema is sent as
   * a structured-output constraint, so the parse is a formality rather than the
   * defence — callers still validate the result before persisting it.
   */
  async generateJson<T>({
    prompt,
    schema,
    temperature = DEFAULT_TEMPERATURE,
  }: GenerateJsonOptions): Promise<T> {
    const text = await this.requestJson(prompt, schema, temperature);

    try {
      return JSON.parse(text) as T;
    } catch {
      this.logger.error(
        `Gemini returned unparsable JSON: ${text.slice(0, 200)}`,
      );
      throw new ServiceUnavailableException(
        'The AI service returned an unexpected response, please try again',
      );
    }
  }

  private async requestJson(
    prompt: string,
    schema: Schema,
    temperature: number,
  ): Promise<string> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature,
        },
      });
      if (!response.text) {
        throw new Error('empty response');
      }
      return response.text;
    } catch (err) {
      this.logger.error(`Gemini request failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        'The AI service is unavailable, please try again later',
      );
    }
  }
}
