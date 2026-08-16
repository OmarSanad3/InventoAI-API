/**
 * What a knowledge document was composed from. One table holds all four, so a
 * retrieval can ask for products only, FAQ only, or everything at once.
 *
 * Orders are deliberately absent — see the epic's §3. An order's state is a
 * question about the row *now*, and an embedding is a copy that was true when it
 * was written; worse, a vector index has no notion of who may see a row.
 */
export enum KnowledgeSourceType {
  Product = 'product',
  Faq = 'faq',
  Category = 'category',
  StoreProfile = 'store_profile',
}
