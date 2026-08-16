/**
 * What the owner did about a line.
 *
 * There is no way back to `New`: an owner who changes their mind waits for
 * tomorrow, and the suppression window is a week.
 */
export enum AdvisorInsightStatus {
  New = 'new',
  /** "I ordered more." Kept so a later brief can say how long ago. */
  Acted = 'acted',
  /** "I know." Suppressed for `INSIGHT_SUPPRESSION_DAYS`. */
  Dismissed = 'dismissed',
}
