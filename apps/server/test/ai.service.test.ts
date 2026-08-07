import { describe, it, expect, beforeEach } from 'vitest'
import { AuditLogger } from '../src/audit/service.js'
import { AiService } from '../src/ai/service.js'
import { FakeAiProvider } from '../src/ai/fake.js'
import { AiLimitError, AiTimeoutError, AiProviderError } from '../src/ai/errors.js'

/**
 * Ticket 10 — AI 供应商抽象层 (Seam 1: 应用服务公共接口)。
 * 领域行为不依赖具体供应商；预算护栏与审计在服务层统一施加。
 * 不变量：供应商可切换；超时/超限被拒绝并记录；每次调用写审计（含操作者）。
 */
describe('AiService (Ticket 10, service seam)', () => {
  let audit: AuditLogger
  let ai: AiService
  const basicBudget = { timeoutMs: 500, maxOutputTokens: 100, maxCalls: 0 }

  beforeEach(() => {
    audit = new AuditLogger()
    const alpha = new FakeAiProvider('alpha', () => ({ text: 'ALPHA:' + '_', tokens: { prompt: 3, completion: 4 } }))
    const bravo = new FakeAiProvider('bravo', () => ({ text: 'BRAVO:' + '_', tokens: { prompt: 2, completion: 2 } }))
    ai = new AiService(
      audit,
      new Map([
        [alpha.name, alpha],
        [bravo.name, bravo],
      ]),
      'alpha',
      basicBudget,
    )
  })

  it('fulfills a completion and audits it with the operator', async () => {
    const result = await ai.complete('找一本讲二战的入门书', { operatorId: 'librarian-1' })
    expect(result.text).toContain('ALPHA')

    const entries = audit.list()
    expect(entries).toHaveLength(1)
    const e = entries[0]
    expect(e.operatorId).toBe('librarian-1')
    expect(e.provider).toBe('alpha')
    expect(e.prompt).toBe('找一本讲二战的入门书')
    expect(e.outcome).toBe('fulfilled')
    expect(e.output).toContain('ALPHA')
    expect(e.time).toBeTruthy()
  })

  it('audits anonymous (public) calls without an operator', async () => {
    await ai.complete('找一本讲二战的入门书')
    const e = audit.list()[0]
    expect(e.operatorId).toBeUndefined()
  })

  it('switches provider by name without changing the business interface', async () => {
    const result = await ai.complete('x', { provider: 'bravo' })
    expect(result.text).toContain('BRAVO')
    expect(audit.list()[0].provider).toBe('bravo')
  })

  it('audits a timeout rejection and exposes a typed error', async () => {
    const slow = new FakeAiProvider('slow', async () => {
      await new Promise((r) => setTimeout(r, 2000))
      return { text: 'late' }
    })
    const slowAi = new AiService(audit, new Map([['slow', slow]]), 'slow', {
      timeoutMs: 20,
      maxOutputTokens: 100,
      maxCalls: 0,
    })

    await expect(slowAi.complete('x')).rejects.toBeInstanceOf(AiTimeoutError)
    const e = audit.list()[0]
    expect(e.outcome).toBe('rejected')
    expect(e.rejectionReason).toBe('timeout')
  })

  it('rejects when the per-instance call budget is exhausted and audits it', async () => {
    const capped = new AiService(audit, new Map([['alpha', new FakeAiProvider('alpha', () => ({ text: 'ok' }))]]), 'alpha', {
      timeoutMs: 500,
      maxOutputTokens: 100,
      maxCalls: 1,
    })

    await capped.complete('first')
    await expect(capped.complete('second')).rejects.toBeInstanceOf(AiLimitError)
    const e = audit.list()[0]
    expect(e.outcome).toBe('rejected')
    expect(e.rejectionReason).toBe('budget_exceeded')
  })

  it('maps an unknown provider to a typed error without calling', async () => {
    await expect(ai.complete('x', { provider: 'nope' })).rejects.toBeInstanceOf(AiProviderError)
    expect(audit.list()).toHaveLength(0)
  })
})