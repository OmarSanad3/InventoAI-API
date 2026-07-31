export class ConfirmDomainResponseDto {
  slug!: string;
  storeUrl!: string;
  /**
   * Advisory only — the slug is already reserved for this owner. Set when an
   * existing store has a name customers could confuse with this one.
   */
  hint!: string | null;
}
