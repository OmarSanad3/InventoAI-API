/**
 * How far an owner has progressed through the site builder. The value only ever
 * advances — see `SITE_BUILD_STEP_ORDER` in the site-builder constants — so
 * re-running an earlier step never rewinds the flow.
 */
export enum SiteBuildStep {
  Brainstormed = 'brainstormed',
  Answered = 'answered',
  DomainConfirmed = 'domain_confirmed',
  Themed = 'themed',
  Published = 'published',
}
