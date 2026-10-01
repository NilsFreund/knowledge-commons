export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: KnowledgeError }

export type ErrorCode =
  | 'store_not_found'
  | 'invalid_config'
  | 'invalid_entry'
  | 'entry_not_found'
  | 'entry_exists'
  | 'prompt_not_found'
  | 'io_failed'

export interface KnowledgeError {
  readonly code: ErrorCode
  readonly message: string
  readonly detail?: readonly string[]
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err<T>(code: ErrorCode, message: string, detail?: readonly string[]): Result<T> {
  return { ok: false, error: detail ? { code, message, detail } : { code, message } }
}

export function formatError(error: KnowledgeError): string {
  return error.detail?.length ? `${error.message}\n  ${error.detail.join('\n  ')}` : error.message
}
