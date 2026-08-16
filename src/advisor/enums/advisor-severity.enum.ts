/**
 * How loudly an insight asks for attention, and the first sort key of a brief.
 *
 * The distinction is only worth having because `stockout` and `restock` are
 * separate kinds: a restock is a plan for next week, a stockout is money not
 * being made this afternoon.
 */
export enum AdvisorSeverity {
  Critical = 'critical',
  Warning = 'warning',
  Info = 'info',
}
