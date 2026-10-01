import type { SimilarityInput } from '../src/core/index.ts'

/** Invented rules whose wording overlaps without meaning the same thing; they pin the threshold. */
export const NEVER_COMMIT: SimilarityInput = {
  name: 'feedback-never-commit',
  description: 'The user performs all git operations themselves; never commit, push or merge',
  body: 'Never run git commit, git push or git merge. Stage the changes and stop there, then report what is staged. This holds even when a task is phrased as "deploy it" or "merge it".',
}

/** The same rule as NEVER_COMMIT, written by someone who had not seen it. */
export const NEVER_COMMIT_REWORDED: SimilarityInput = {
  name: 'git-is-the-users-job',
  description: 'Do not commit or push on the user behalf, they handle git themselves',
  body: 'The user handles every git operation. Do not create commits, do not push branches, do not merge. Stage what you changed and hand back.',
}

/** Shares the word "commit" with NEVER_COMMIT and nothing else. The hardest false positive. */
export const COMMIT_MESSAGES: SimilarityInput = {
  name: 'feedback-commit-messages',
  description: 'Commit messages are a single Conventional-Commits subject line, no body',
  body: 'When a commit message is requested, write one Conventional-Commits subject line and nothing else. No body, no bullet list, no trailer.',
}

export const SHORT_ANSWERS: SimilarityInput = {
  name: 'feedback-short-answers',
  description: 'Keep answers short: a TLDR and a few lines, detail only on request',
  body: 'Default to a TLDR plus a few lines. No essays, no restating the question. Expand only when the user asks for detail.',
}

export const METRICS_DASHBOARD: SimilarityInput = {
  name: 'reference-metrics-dashboard',
  description: 'The dashboard rounds every bucket up to a whole minute',
  body: 'Buckets are five minutes wide and the last one is padded, so a short spike reads as a long one.',
}
