import type { AiCompletionRequest, AiCompletionResult, AiProvider } from './provider.js'
import { AiProviderError } from './errors.js'

/**
 * DeepSeek 供应商 —— 默认国内模型（OpenAI 兼容 API，`deepseek-chat`）。
 * 契合未成年人数据合规（ADR-0002）：优先部署在国内，避免跨境传输。
 * 仅做请求/响应适配；超时与预算由 AiService 统一施加，不在此处理。
 */
export class DeepSeekProvider implements AiProvider {
  readonly name = 'deepseek'

  constructor(private readonly apiKey: string) {}

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const timeoutMs = 30_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        signal: mergeSignal(controller.signal, request.signal),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: request.prompt }],
          max_tokens: request.maxOutputTokens ?? 1000,
        }),
      })
      if (!res.ok) {
        throw new AiProviderError(`deepseek responded ${res.status}: ${await res.text()}`)
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const text = data.choices?.[0]?.message?.content?.trim()
      if (!text) throw new AiProviderError('deepseek returned an empty completion')
      return {
        text,
        tokens: {
          prompt: data.usage?.prompt_tokens ?? 0,
          completion: data.usage?.completion_tokens ?? 0,
        },
      }
    } catch (err) {
      if (controller.signal.aborted || (request.signal && request.signal.aborted)) {
        // AiService 负责将超时映射为 AiTimeoutError
        throw err
      }
      throw err instanceof AiProviderError
        ? err
        : new AiProviderError(`deepseek call failed: ${(err as Error).message}`)
    } finally {
      clearTimeout(timer)
    }
  }
}

function mergeSignal(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => Boolean(s))
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]
  const controller = new AbortController()
  for (const s of active) {
    if (s.aborted) {
      controller.abort(s.reason)
      break
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true })
  }
  return controller.signal
}