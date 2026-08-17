import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '../ai/gemini.service';
import { DraftStatus } from './enums/draft-status.enum';
import {
  buildDraftRequestPrompt,
  buildDraftRequestSchema,
  type DraftRequestPromptOptions,
} from './prompts/draft-request.prompt';
import {
  REQUEST_BODY_MAX_LENGTH,
  REQUEST_DRAFT_TEMPERATURE,
  REQUEST_SUBJECT_MAX_LENGTH,
} from './suppliers.constants';
import {
  appendSignOff,
  buildFallbackRequestEmail,
  type RequestEmailDraft,
} from './utils/fallback-request-email.util';

/** A draft, and the record of who wrote it. */
export interface DraftedRequest extends RequestEmailDraft {
  readonly draftStatus: DraftStatus;
}

interface DraftResponse {
  subject?: unknown;
  body?: unknown;
}

/**
 * Writes the purchase-request email, and is the least important service here.
 *
 * The template underneath it already says everything the mail must say, so a
 * Gemini outage costs an owner some warmth of phrasing and never the ability to
 * send — the same bargain `AdvisorNarrator` makes, and the reason the row
 * records `draftStatus`. The owner reviews and edits whatever comes back before
 * a single supplier is mailed, which is also why the model's output needs no
 * defence beyond being text: nothing it writes is a fact anybody acts on
 * unread.
 */
@Injectable()
export class SupplierDraftService {
  private readonly logger = new Logger(SupplierDraftService.name);

  constructor(private readonly geminiService: GeminiService) {}

  async draft(options: DraftRequestPromptOptions): Promise<DraftedRequest> {
    const fallback = buildFallbackRequestEmail(options);

    try {
      const response = await this.geminiService.generateJson<DraftResponse>({
        prompt: buildDraftRequestPrompt(options),
        schema: buildDraftRequestSchema(),
        temperature: REQUEST_DRAFT_TEMPERATURE,
      });

      const subject = clean(response.subject, REQUEST_SUBJECT_MAX_LENGTH);
      const body = clean(response.body, REQUEST_BODY_MAX_LENGTH);
      if (!subject || !body) {
        return { ...fallback, draftStatus: DraftStatus.Fallback };
      }

      return {
        subject,
        // The sign-off is added here rather than asked for — see `appendSignOff`.
        body: appendSignOff(body, options.storeName),
        draftStatus: DraftStatus.Ai,
      };
    } catch (error) {
      // Not fatal, and deliberately not rethrown: the mail is already written.
      this.logger.warn(
        `Drafting failed, falling back to the template: ${String(error)}`,
      );
      return { ...fallback, draftStatus: DraftStatus.Fallback };
    }
  }
}

function clean(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
}
