/**
 * `text` questions answer with a string, `single` with an option index and
 * `multi` with an array of option indexes. `null` means "the AI could not infer
 * it" or "the owner left it blank".
 */
export type AnswerValue = string | number | number[] | null;

export interface QuestionAnswer {
  readonly questionId: string;
  readonly answer: AnswerValue;
}
