export class SubmitAnswersResponseDto {
  businessName!: string;
  /** Slugified business name, pre-filled into the domain input. */
  suggestedDomain!: string;
  /** Near-collision advisory for the suggested domain, or `null` when it is clear. */
  hint!: string | null;
}
