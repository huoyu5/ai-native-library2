import type { AiUsage } from '../audit/service.js'
import type { AiProviderError } from './errors.js'

/**
 * AI 供应商抽象层的基础类型（Ticket 10）。
 * 业务代码只依赖 `AiProvider` 接口（不随具体供应商变化）；
 * 供应商实现（DeepSeek / 通义 / 智谱 / 假实现）各自适配这一薄接口。
 */
export interface AiCompletionRequest {
  prompt: string
  /** 单次输出 token 上限（成本护栏，由 AiService/预算施加） */
  maxOutputTokens?: number
  /** 供应商应尊重的取消信号（AiService 用它实现超时） */
  signal?: AbortSignal
}

export interface AiCompletionResult {
  text: string
  tokens?: AiUsage
}

export interface AiProvider {
  readonly name: string
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>
}

export type { AiProviderError }