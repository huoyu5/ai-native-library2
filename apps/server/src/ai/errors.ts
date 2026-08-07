/**
 * AI 层的类型化错误（Ticket 10）。
 * 上层根据错误类型判断降级路径：provider 不可用/超时 → 检索退化、编目退化为手工录入。
 */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly name: 'AiProviderError' = 'AiProviderError',
  ) {
    super(message)
  }
}

export class AiTimeoutError extends Error {
  constructor(message = 'AI request timed out', readonly name: 'AiTimeoutError' = 'AiTimeoutError') {
    super(message)
  }
}

export class AiLimitError extends Error {
  constructor(
    message = 'AI call budget exceeded',
    readonly name: 'AiLimitError' = 'AiLimitError',
  ) {
    super(message)
  }
}