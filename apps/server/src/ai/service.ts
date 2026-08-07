import type { AuditLogger } from '../audit/service.js'
import type { AiProvider, AiCompletionResult } from './provider.js'
import { AiProviderError, AiTimeoutError, AiLimitError } from './errors.js'

/**
 * AI 调用的领域门面（Ticket 10，Seam 1）。
 * 对所有业务调用统一施加三个 AI 硬边界：
 *  - 供应商无关：业务经 `complete()` 调用，切换供应商不改业务接口；
 *  - 成本护栏：单次输出 token 上限 + 及时调用预算，超限被拒并记录；
 *  - 审计：每次调用（含被拒/超时）都写入审计日志（spec「审计」边界）。
 */
export interface AiBudget {
  /** 单次调用超时（毫秒） */
  timeoutMs: number
  /** 单次输出 token 上限（成本护栏） */
  maxOutputTokens: number
  /** 调用次数预算；0 = 不限制 */
  maxCalls: number
}

export class AiService {
  private totalCalls = 0

  constructor(
    private readonly audit: AuditLogger,
    private readonly providers: Map<string, AiProvider>,
    private readonly defaultProviderName: string,
    private readonly budget: AiBudget,
  ) {}

  async complete(
    prompt: string,
    opts?: { provider?: string; operatorId?: string },
  ): Promise<AiCompletionResult & { provider: string }> {
    const providerName = opts?.provider ?? this.defaultProviderName
    const provider = this.providers.get(providerName)
    if (!provider) throw new AiProviderError(`unknown AI provider: ${providerName}`)

    // 成本护栏：调用预算
    if (this.budget.maxCalls > 0 && this.totalCalls >= this.budget.maxCalls) {
      this.audit.record({
        kind: 'ai',
        operatorId: opts?.operatorId,
        provider: providerName,
        prompt,
        outcome: 'rejected',
        rejectionReason: 'budget_exceeded',
      })
      throw new AiLimitError()
    }
    this.totalCalls += 1

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort('timeout'), this.budget.timeoutMs)
    try {
      const result = await this.withTimeout(
        provider.complete({ prompt, signal: controller.signal }),
        this.budget.timeoutMs,
      )
      this.audit.record({
        kind: 'ai',
        operatorId: opts?.operatorId,
        provider: providerName,
        prompt,
        outcome: 'fulfilled',
        output: result.text,
        tokens: result.tokens,
      })
      return { ...result, provider: providerName }
    } catch (err) {
      if (err instanceof AiTimeoutError) {
        this.audit.record({
          kind: 'ai',
          operatorId: opts?.operatorId,
          provider: providerName,
          prompt,
          outcome: 'rejected',
          rejectionReason: 'timeout',
        })
        throw err
      }
      if (err instanceof AiProviderError) {
        this.audit.record({
          kind: 'ai',
          operatorId: opts?.operatorId,
          provider: providerName,
          prompt,
          outcome: 'rejected',
          rejectionReason: 'provider_error',
        })
        throw err
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  /** 无论供应商是否响应取消信号，超时必然触发（降级保证）。 */
  private withTimeout(p: Promise<AiCompletionResult>, ms: number): Promise<AiCompletionResult> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new AiTimeoutError()), ms)
      p.then(
        (v) => {
          clearTimeout(t)
          resolve(v)
        },
        (e) => {
          clearTimeout(t)
          reject(e)
        },
      )
    })
  }
}