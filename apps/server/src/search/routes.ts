import type { FastifyInstance } from 'fastify'
import type { SearchService } from './service.js'

/**
 * 公共检索 HTTP seam（Ticket 09，Seam 2）。
 * GET /api/search?q=  — 免登录关键词检索（无鉴权契约）。
 */
export function registerSearchRoutes(app: FastifyInstance, search: SearchService) {
  app.get('/api/search', async (req, reply) => {
    const q = typeof (req.query as { q?: string }).q === 'string' ? (req.query as { q: string }).q : ''
    const trimmed = q.trim()
    if (!trimmed) {
      return reply.code(422).send({ error: 'q 检索词必填' })
    }
    return { results: search.search(trimmed) }
  })
}