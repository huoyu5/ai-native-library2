import type { AiCompletionRequest, AiCompletionResult, AiProvider } from './provider.js'

/**
 * 假供应商：确定性、无网络，供测试与无 key 时的降级/演示。
 * 测试注入特定行为（文本、延迟、失败），运行期作为降级 provider（AI 不可用时不空转）。
 */
export class FakeAiProvider implements AiProvider {
  constructor(
    readonly name: string,
    private readonly impl: (request: AiCompletionRequest) => AiCompletionResult | Promise<AiCompletionResult>,
  ) {}

  complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    return Promise.resolve(this.impl(request))
  }
}