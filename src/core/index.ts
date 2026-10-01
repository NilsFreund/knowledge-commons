export { loadConfig, saveConfig } from './config.ts'
export { discoverSources, resolveSlug, type DiscoveredSource } from './discover.ts'
export { diagnose, type DiagnoseInput, type Diagnostic } from './doctor.ts'
export { findCandidates, findNearDuplicates, type Candidate, type DuplicatePair } from './duplicates.ts'
export { extractLinks, extractMalformedLinks, parseEntryFile, serializeEntryFile } from './entry-file.ts'
export { findInstructionFiles } from './instructions.ts'
export { initStore, type InitResult } from './init.ts'
export { listPrompts, readPrompt } from './prompts.ts'
export { err, formatError, ok, type ErrorCode, type KnowledgeError, type Result } from './result.ts'
export {
  parseResearchFile,
  parseSections,
  researchFrontmatterSchema,
  researchId,
  ResearchStore,
  researchWriteSchema,
  serializeResearchFile,
  type ResearchDoc,
  type ResearchHit,
  type ResearchOutcome,
  type ResearchSection,
  type ResearchSummary,
  type ResearchWriteInput,
} from './research.ts'
export { searchScore, tokenize, type Searchable } from './search.ts'
export { withWriteLock, writeFileAtomic } from './write.ts'
export {
  pruneUsage,
  readUsage,
  recordUsage,
  STATS_FILE,
  summarize,
  usageEventSchema,
  type UsageCount,
  type UsageEvent,
  type UsageSummary,
} from './stats.ts'
export { isWithin, resolveScope, type ScopeMatch } from './scope.ts'
export { contentTokens, normalize, similarity, type SimilarityInput } from './similarity.ts'
export {
  Store,
  writeInputSchema,
  type ContextInput,
  type ContextResult,
  type LoadedEntries,
  type RemoveOutcome,
  type RenameOutcome,
  type SearchHit,
  type SearchOptions,
  type StoreOptions,
  type WriteInput,
  type WriteOutcome,
} from './store.ts'
export {
  configSchema,
  DEFAULT_DEDUPE_THRESHOLD,
  DEFAULT_SCOPE,
  duplicateKey,
  ENTRY_TYPES,
  entryId,
  frontmatterSchema,
  scopeRuleSchema,
  toIndexRow,
  type Entry,
  type EntryType,
  type Frontmatter,
  type IndexRow,
  type ScopeRule,
  type StoreConfig,
} from './types.ts'
