/**
 * Fifty shoppers asking for earbuds type fifty different sentences. A list of
 * fifty rows is not a demand signal; "wireless earbuds — 45 times" is.
 *
 * This is the deterministic pass, and it runs always: lowercase, strip
 * diacritics and punctuation, drop a small stop-word list, sort what is left,
 * and group on the result. It collapses "do you have wireless earbuds" and
 * "wireless earbuds?" and nothing cleverer — pulling "earbuds", "airpods" and
 * "سماعات لاسلكية" together is the semantic pass's job, and it arrives here as a
 * pre-computed `clusterKey` rather than as an embedding call inside a read.
 */

/** One unanswered question, as the feed and the Advisor both read it. */
export interface UnansweredInput {
  /** The **assistant** message id: the row that carries the resolution. */
  readonly id: string;
  readonly question: string;
  readonly askedAt: Date;
  /** The nightly pass's grouping, when it has run. */
  readonly clusterKey: string | null;
  readonly isReviewed: boolean;
}

export interface UnansweredGroup {
  /** Stable within a window; the review route addresses a group by it. */
  readonly key: string;
  /** The theme, in the shortest phrasing a shopper used for it. */
  readonly label: string;
  readonly occurrences: number;
  /** The most recent phrasing, verbatim — what the owner actually reads. */
  readonly exampleQuestion: string;
  readonly lastAskedAt: Date;
  /** Every message behind the group, so one review marks all of them. */
  readonly messageIds: string[];
  /** True only when every occurrence has been reviewed. */
  readonly isReviewed: boolean;
}

/**
 * Words that carry no demand signal. Deliberately short: a long stop-word list
 * starts merging themes that are not the same one, and the semantic pass is the
 * right tool for anything subtler than "do you have".
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  // English
  'a',
  'an',
  'and',
  'any',
  'are',
  'at',
  'be',
  'can',
  'could',
  'de',
  'did',
  'do',
  'does',
  'for',
  'from',
  'get',
  'got',
  'has',
  'have',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'sell',
  'some',
  'that',
  'the',
  'there',
  'these',
  'this',
  'those',
  'to',
  'want',
  'was',
  'we',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  'yours',
  'please',
  'need',
  'looking',
  'look',
  'find',
  'stock',
  // Contractions, closed up by `APOSTROPHES` below. Without these "I'm looking
  // for a leather handbag" and "leather handbag?" are two themes rather than
  // one, which is exactly the split this grouping exists to prevent.
  'im',
  'its',
  'ive',
  'id',
  'ill',
  'dont',
  'doesnt',
  'didnt',
  'cant',
  'couldnt',
  'wouldnt',
  'isnt',
  'arent',
  'wasnt',
  'wont',
  'youre',
  'youve',
  'theres',
  'lets',
  // Arabic
  'هل',
  'عندكم',
  'عندك',
  'لديكم',
  'في',
  'من',
  'على',
  'الى',
  'إلى',
  'او',
  'أو',
  'و',
  'ما',
  'ماذا',
  'هذا',
  'هذه',
  'ذلك',
  'التي',
  'الذي',
  'انا',
  'أنا',
  'انت',
  'أنت',
  'كيف',
  'اين',
  'أين',
  'متى',
  'كم',
  'يوجد',
  'ابحث',
  'اريد',
  'أريد',
  'ممكن',
  'لو',
  'سمحت',
  'بيع',
  'تبيعون',
]);

/**
 * Combining marks — the Latin accents `NFD` leaves behind, and the Arabic
 * harakat, which are optional in writing and so are typed by some shoppers and
 * not by others.
 */
const DIACRITICS = /\p{M}+/gu;

/**
 * Apostrophes, in every form a keyboard produces them.
 *
 * Removed rather than replaced with a space, and **before** `NON_WORD`: turning
 * "I'm" into "i m" leaves a bare `m` that no stop-word list can sensibly hold,
 * and that one stray token is enough to split a theme in two.
 */
const APOSTROPHES = /['’‘`´]/g;

/** Everything that is not a letter, a digit or a space, across scripts. */
const NON_WORD = /[^\p{L}\p{N}\s]+/gu;

const WHITESPACE = /\s+/;

export interface SummarizeOptions {
  readonly maxGroups: number;
}

/**
 * Groups the rows and orders them by `occurrences DESC`, then most recent
 * first. Rows arrive newest-first or oldest-first indifferently — the group's
 * own dates are computed rather than assumed.
 */
export function summarizeUnanswered(
  rows: readonly UnansweredInput[],
  { maxGroups }: SummarizeOptions,
): UnansweredGroup[] {
  return mergeByCluster(bucketByTokens(rows))
    .sort(compareGroups)
    .slice(0, maxGroups)
    .map(freeze);
}

/** Pass one: the deterministic grouping, which runs whatever else is available. */
function bucketByTokens(rows: readonly UnansweredInput[]): MutableGroup[] {
  const buckets = new Map<string, MutableGroup>();

  for (const row of rows) {
    const tokens = tokenize(row.question);
    const key = buildGroupKey(tokens, row.question);
    const bucket = buckets.get(key) ?? createGroup(key);

    bucket.messageIds.push(row.id);
    bucket.occurrences += 1;
    bucket.isReviewed &&= row.isReviewed;
    // The first one wins, and a bucket only ever holds one phrasing — so the
    // rows asked *since* the nightly pass ran inherit the cluster their older
    // twins were put in, rather than splitting off into a group of their own.
    bucket.clusterKey ??= row.clusterKey;

    if (row.askedAt.getTime() >= bucket.lastAskedAt.getTime()) {
      bucket.lastAskedAt = row.askedAt;
      bucket.exampleQuestion = row.question.trim();
    }
    // The shortest phrasing reads best as a theme: "wireless earbuds" rather
    // than "do you have any wireless earbuds in stock".
    const label = tokens.length > 0 ? tokens.join(' ') : row.question.trim();
    if (bucket.label === '' || label.length < bucket.label.length) {
      bucket.label = label;
    }

    buckets.set(key, bucket);
  }

  return [...buckets.values()];
}

/**
 * Pass two: fold the buckets the nightly semantic pass decided were the same
 * theme into one another. A bucket with no `clusterKey` stands alone, which is
 * exactly the grouping a store with no embedding service ever gets.
 */
function mergeByCluster(buckets: readonly MutableGroup[]): MutableGroup[] {
  const merged = new Map<string, MutableGroup>();

  for (const bucket of buckets) {
    const key = bucket.clusterKey ?? bucket.key;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...bucket, key });
      continue;
    }

    existing.occurrences += bucket.occurrences;
    existing.messageIds.push(...bucket.messageIds);
    existing.isReviewed &&= bucket.isReviewed;
    if (bucket.label.length < existing.label.length) {
      existing.label = bucket.label;
    }
    if (bucket.lastAskedAt.getTime() > existing.lastAskedAt.getTime()) {
      existing.lastAskedAt = bucket.lastAskedAt;
      existing.exampleQuestion = bucket.exampleQuestion;
    }
  }

  return [...merged.values()];
}

/**
 * The normalised tokens of a question, in the order they were typed, with the
 * stop words dropped. Exported because the clustering pass groups on the same
 * tokens it does.
 */
export function tokenize(question: string): string[] {
  const normalized = question
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(NON_WORD, ' ')
    .trim();

  return normalizeArabic(normalized)
    .split(WHITESPACE)
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

/**
 * The key two phrasings of one question share.
 *
 * Sorted, so word order does not split a group; falls back to the whole
 * normalised sentence when every token was a stop word, because grouping every
 * "do you have?" in the store together would be one meaningless line.
 */
export function buildGroupKey(
  tokens: readonly string[],
  original: string,
): string {
  if (tokens.length === 0) {
    return original.trim().toLowerCase();
  }
  return [...tokens].sort().join(' ');
}

/**
 * Alef, teh marbuta and alef maqsura are typed inconsistently and mean the same
 * word — the written-Arabic equivalent of the stemming `SEARCH_TEXT_CONFIG`
 * gives English and cannot give Arabic.
 */
function normalizeArabic(text: string): string {
  return text
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

interface MutableGroup {
  key: string;
  clusterKey: string | null;
  label: string;
  occurrences: number;
  exampleQuestion: string;
  lastAskedAt: Date;
  messageIds: string[];
  isReviewed: boolean;
}

function createGroup(key: string): MutableGroup {
  return {
    key,
    clusterKey: null,
    label: '',
    occurrences: 0,
    exampleQuestion: '',
    lastAskedAt: new Date(0),
    messageIds: [],
    isReviewed: true,
  };
}

function compareGroups(a: MutableGroup, b: MutableGroup): number {
  return (
    b.occurrences - a.occurrences ||
    b.lastAskedAt.getTime() - a.lastAskedAt.getTime() ||
    a.key.localeCompare(b.key)
  );
}

/** `clusterKey` is grouping machinery, not something a reader of the feed needs. */
function freeze(group: MutableGroup): UnansweredGroup {
  return {
    key: group.key,
    label: group.label,
    occurrences: group.occurrences,
    exampleQuestion: group.exampleQuestion,
    lastAskedAt: group.lastAskedAt,
    messageIds: group.messageIds,
    isReviewed: group.isReviewed,
  };
}
