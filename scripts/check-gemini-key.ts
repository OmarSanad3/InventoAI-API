/**
 * Probes a Gemini API key against the models this project actually uses.
 *
 * ```bash
 * npm run check:gemini                 # the key in .env
 * npm run check:gemini -- AIza...      # someone else's key
 * npm run check:gemini -- AIza... gemini-3.5-flash gemini-3.6-flash
 * ```
 *
 * It makes a **real one-token call** per model rather than reading
 * `GET /models`. That listing is not the answer: it happily lists
 * `gemini-2.5-flash` for an account that gets
 * `404 … no longer available to new users` the moment it calls it.
 *
 * A 429 is reported with the quota that ran out, because the two that matter
 * look identical from the outside and are wildly different in practice — a
 * per-minute limit clears itself in a minute, a per-day one does not.
 */
import * as dotenv from 'dotenv';

dotenv.config();

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

interface Probe {
  readonly model: string;
  readonly status: 'ok' | 'unavailable' | 'quota' | 'auth' | 'error';
  readonly detail: string;
}

async function probeGeneration(key: string, model: string): Promise<Probe> {
  const response = await fetch(
    `${ENDPOINT}/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }),
    },
  );
  return classify(model, response.status, await response.json());
}

async function probeEmbedding(key: string, model: string): Promise<Probe> {
  const response = await fetch(`${ENDPOINT}/${model}:embedContent?key=${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text: 'hi' }] },
      outputDimensionality: Number(process.env.EMBEDDING_DIMENSIONS ?? 768),
    }),
  });
  const body = (await response.json()) as {
    embedding?: { values?: number[] };
  };
  if (response.ok) {
    return {
      model,
      status: 'ok',
      detail: `${body.embedding?.values?.length ?? 0} dimensions`,
    };
  }
  return classify(model, response.status, body);
}

function classify(model: string, httpStatus: number, body: unknown): Probe {
  const error = (body as { error?: GeminiError }).error;
  if (!error) {
    return { model, status: 'ok', detail: '' };
  }

  if (httpStatus === 404) {
    return {
      model,
      status: 'unavailable',
      detail: firstSentence(error.message),
    };
  }
  if (httpStatus === 429) {
    return { model, status: 'quota', detail: describeQuota(error) };
  }
  if (httpStatus === 400 || httpStatus === 403) {
    return { model, status: 'auth', detail: firstSentence(error.message) };
  }
  return {
    model,
    status: 'error',
    detail: `${httpStatus} ${firstSentence(error.message)}`,
  };
}

interface GeminiError {
  readonly message: string;
  readonly details?: {
    readonly '@type'?: string;
    readonly violations?: { quotaId?: string; quotaValue?: string }[];
  }[];
}

/**
 * The whole reason this script exists in the form it does: "per minute" means
 * wait, "per day" means find another key.
 */
function describeQuota(error: GeminiError): string {
  const violations = (error.details ?? []).flatMap(
    (detail) => detail.violations ?? [],
  );
  if (violations.length === 0) {
    return 'quota exhausted';
  }
  return violations
    .map((violation) => {
      const id = violation.quotaId ?? 'unknown quota';
      const period = /PerDay/i.test(id)
        ? 'per DAY — this key is done until it resets'
        : /PerMinute/i.test(id)
          ? 'per minute — wait and retry'
          : '';
      return `${id} = ${violation.quotaValue ?? '?'} ${period}`.trim();
    })
    .join('; ');
}

function firstSentence(message: string): string {
  return message.split('. ')[0];
}

const ICONS: Record<Probe['status'], string> = {
  ok: '  OK        ',
  unavailable: '  NOT FOR YOU',
  quota: '  QUOTA     ',
  auth: '  BAD KEY   ',
  error: '  ERROR     ',
};

async function main(): Promise<void> {
  const [maybeKey, ...extraModels] = process.argv.slice(2);
  const key =
    maybeKey && maybeKey.startsWith('AIza')
      ? maybeKey
      : (process.env.GEMINI_API_KEY ?? '');
  const models =
    maybeKey && !maybeKey.startsWith('AIza')
      ? [maybeKey, ...extraModels]
      : extraModels;

  if (!key) {
    console.error(
      '\n  No key. Pass one as an argument or set GEMINI_API_KEY.\n',
    );
    process.exit(1);
  }

  const generationModels = [
    ...new Set(
      [process.env.GEMINI_MODEL, process.env.CHATBOT_MODEL, ...models].filter(
        (model): model is string => Boolean(model),
      ),
    ),
  ];
  const embeddingModel = process.env.GEMINI_EMBEDDING_MODEL;

  console.log(`\n  key ...${key.slice(-6)}\n`);
  console.log('  generation (one real call each)');
  for (const model of generationModels) {
    const probe = await probeGeneration(key, model);
    console.log(`${ICONS[probe.status]} ${model.padEnd(26)} ${probe.detail}`);
  }

  if (embeddingModel) {
    console.log('\n  embeddings');
    const probe = await probeEmbedding(key, embeddingModel);
    console.log(
      `${ICONS[probe.status]} ${embeddingModel.padEnd(26)} ${probe.detail}`,
    );
  }
  console.log('');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
