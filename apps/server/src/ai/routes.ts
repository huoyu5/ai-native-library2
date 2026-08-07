import type { FastifyInstance } from 'fastify'
import { requireRoles } from '../auth/routes.js'
import type { AiService } from './service.js'
import type { AuditLogger } from '../audit/service.js'
import { AiProviderError, AiTimeoutError, AiLimitError } from './errors.js'

/**
 * AI 供应商抽象层 HTTP seam（Ticket 10，Seam 2）。
 * - POST /api/ai/complete  —— 管理员触发的受保护 AI 调用（接线/验证点），每个调用写审计
 * - GET  /api/admin/audit  —— 管理员查询 AI 操作审计日志（spec #28）
 */
export function registerAiRoutes(app: FastifyInstance, ai: AiService, audit: AuditLogger) {
  app.post(
    '/api/ai/complete',
    { preHandler: [requireRoles(app, 'admin')] },
    async (req, reply) => {
      const body = req.body as { prompt?: unknown; provider?: unknown }
      const prompt = typeof body?.prompt === 'string' ? body.prompt : ''
      if (!prompt) {
        return reply.code(422).send({ error: 'prompt required' })
      }
      const provider = typeof body?.provider === 'string' ? body.provider : undefined
      try {
        const r = await ai.complete(prompt, { provider, operatorId: req.user.sub })
        return { text: r.text, provider: r.provider, tokens: r.tokens }
      } catch (err) {
        if (err instanceof AiTimeoutError) return reply.code(503).send({ error: 'ai timeout' })
        if (err instanceof AiLimitError) return reply.code(429).send({ error: 'ai budget exceeded' })
        if (err instanceof AiProviderError) return reply.code(502).send({ error: err.message })
        throw err
      }
    },
  )

  app.get('/api/admin/audit', { preHandler: [requireRoles(app, 'admin')] }, async () => ({
    entries: audit.list(),
  }))
}