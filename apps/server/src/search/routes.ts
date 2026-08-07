import type { FastifyInstance } from 'fastify'
import type { SearchService } from './service.js'
import { ValidationError, type SemanticSearchService } from './semantic.js'

/**
 * 公共检索 HTTP seam（Ticket 09/12，Seam 2）。
 * GET /api/search?q=      — 免登录关键词检索（无鉴权契约）。
 * GET /api/search/natural?q= — 免登录自然语言检索：相关度排序 + 引用依据；AI 不可用自动降级。
 */
export function registerSearchRoutes(
  app: FastifyInstance,
  search: SearchService,
  semantic?: SemanticSearchService,
) {
  app.get('/api/search', async (req, reply) => {
    const q = typeof (req.query as { q?: string }).q === 'string' ? (req.query as { q: string }).q : ''
    const trimmed = q.trim()
    if (!trimmed) {
      return reply.code(422).send({ error: 'q 检索词必填' })
    }
    return { results: search.search(trimmed) }
  })

  if (!semantic) return

  app.get('/api/search/natural', async (req, reply) => {
    const q = typeof (req.query as { q?: string }).q === 'string' ? (req.query as { q: string }).q : ''
    try {
      return await semantic.searchNatural(q)
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.code(422).send({ error: error.message })
      }
      throw error
    }
  })
}