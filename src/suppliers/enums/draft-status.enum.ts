/**
 * Who wrote the request email — the model, or the template underneath it.
 *
 * The same record `AdvisorBrief.narratorStatus` keeps, declared here rather
 * than imported from `src/advisor`: nothing imports the Advisor, and a shared
 * enum would be the first thread of a dependency neither module wants.
 */
export enum DraftStatus {
  Ai = 'ai',
  Fallback = 'fallback',
}
