import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from '../ai/gemini.service';
import type { EnvironmentVariables } from '../config/env.validation';
import {
  BRIEF_HEADLINE_MAX_LENGTH,
  INSIGHT_TITLE_MAX_LENGTH,
  NARRATOR_INPUT_TEXT_MAX_LENGTH,
  NARRATOR_TEMPERATURE,
} from './advisor.constants';
import { NarratorStatus } from './enums/narrator-status.enum';
import type { AdvisorSignal } from './types/advisor-signal.type';
import {
  buildFallbackHeadline,
  buildFallbackSentence,
  formatMoney,
  type InsightProse,
} from './utils/fallback-sentence.util';
import {
  buildNarrateBriefPrompt,
  buildNarrateBriefSchema,
  type NarratableInsight,
} from './prompts/narrate-brief.prompt';

/** What the narrator hands back: one prose pair per signal, in order. */
export interface NarratedBrief {
  headline: string;
  lines: InsightProse[];
  status: NarratorStatus;
}

interface NarratorResponse {
  headline?: unknown;
  lines?: unknown;
}

/**
 * The last step, and the least important one.
 *
 * Every number in a brief was measured before this service is called, and every
 * line already has a sentence from `buildFallbackSentence`. The narrator only
 * replaces wording — so if Gemini is down, rate-limited, or returns something
 * unexpected, the brief ships in template prose and the row records
 * `narratorStatus: fallback`. **A Gemini outage costs polish, not the brief.**
 *
 * It is also the module's only contact with untrusted text. Product titles and
 * verbatim shopper questions reach the prompt, so the model is given no tools,
 * no database and no schema field that could carry an instruction back —
 * whatever it writes lands in one `text` column the dashboard renders as text.
 */
@Injectable()
export class AdvisorNarrator {
  private readonly logger = new Logger(AdvisorNarrator.name);

  constructor(
    private readonly geminiService: GeminiService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async narrate({
    signals,
    storeName,
    locale,
    currency,
  }: {
    signals: readonly AdvisorSignal[];
    storeName: string;
    locale: string;
    currency: string;
  }): Promise<NarratedBrief> {
    const fallbackLines = signals.map((signal) =>
      buildFallbackSentence(signal, currency),
    );
    const fallback: NarratedBrief = {
      headline: buildFallbackHeadline(signals),
      lines: fallbackLines,
      status: NarratorStatus.Fallback,
    };

    if (signals.length === 0) {
      return fallback;
    }

    try {
      const response = await this.geminiService.generateJson<NarratorResponse>({
        prompt: buildNarrateBriefPrompt({
          storeName,
          locale,
          currency,
          insights: signals.map((signal, index) =>
            this.toNarratable(signal, index, currency),
          ),
        }),
        schema: buildNarrateBriefSchema(),
        temperature: NARRATOR_TEMPERATURE,
        model: this.configService.get('ADVISOR_MODEL', { infer: true }),
      });

      return this.merge(response, fallback);
    } catch (error) {
      // Not fatal, and deliberately not rethrown: the brief is already written
      // in the fallback above.
      this.logger.warn(
        `Narration failed, falling back to templates: ${String(error)}`,
      );
      return fallback;
    }
  }

  /**
   * The model's answer, accepted line by line.
   *
   * A line it skipped, mis-indexed or returned empty keeps its template
   * sentence rather than losing the whole brief its wording — which also means
   * a partially valid response is still an improvement.
   */
  private merge(
    response: NarratorResponse,
    fallback: NarratedBrief,
  ): NarratedBrief {
    const lines = [...fallback.lines];
    let replaced = 0;

    if (Array.isArray(response.lines)) {
      for (const raw of response.lines) {
        const line = raw as {
          index?: unknown;
          title?: unknown;
          body?: unknown;
        };
        const index = typeof line.index === 'number' ? line.index : -1;
        if (index < 0 || index >= lines.length) {
          continue;
        }

        const title = clean(line.title, INSIGHT_TITLE_MAX_LENGTH);
        const body = clean(line.body, MAX_BODY_LENGTH);
        if (!title || !body) {
          continue;
        }

        lines[index] = { title, body };
        replaced += 1;
      }
    }

    const headline =
      clean(response.headline, BRIEF_HEADLINE_MAX_LENGTH) ?? fallback.headline;

    return {
      headline,
      lines,
      // Honest rather than flattering: a response that improved nothing is a
      // fallback brief, whatever the call reported.
      status: replaced > 0 ? NarratorStatus.Ai : NarratorStatus.Fallback,
    };
  }

  /**
   * What the model is shown: the payload, with money already formatted and
   * every free-text field truncated.
   *
   * **The money conversion is not cosmetic.** Every amount in this codebase is
   * an integer of minor units, and a model handed `1137100` writes "1137100
   * EGP" — a hundredfold error, in a sentence an owner is meant to act on. It
   * did exactly that the first time this ran. The model is trusted to quote a
   * number, not to know the unit it is in, so the unit is resolved here and it
   * only ever sees `11,371 EGP`.
   *
   * The truncation is not a security control — the model has no authority to
   * abuse — it is a bill control. A 40 KB "product title" is still a 40 KB
   * prompt.
   */
  private toNarratable(
    signal: AdvisorSignal,
    index: number,
    currency: string,
  ): NarratableInsight {
    const facts: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(signal.payload)) {
      if (MONEY_PAYLOAD_FIELDS.has(key) && typeof value === 'number') {
        facts[key] = formatMoney(value, currency);
        continue;
      }
      facts[key] =
        typeof value === 'string'
          ? value.slice(0, NARRATOR_INPUT_TEXT_MAX_LENGTH)
          : value;
    }

    return {
      index,
      kind: signal.kind,
      severity: signal.severity,
      facts,
    };
  }
}

/**
 * Payload fields carrying minor units, listed rather than pattern-matched: a
 * new money field must be added here deliberately, and a name that merely looks
 * monetary must not be converted by accident.
 */
const MONEY_PAYLOAD_FIELDS = new Set([
  'estimatedDailyLoss',
  'tiedUpAmount',
  'priceAmount',
]);

/** Two sentences of prose, with room for a long language. */
const MAX_BODY_LENGTH = 600;

function clean(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
}
