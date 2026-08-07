import type { FastifyInstance, FastifyReply } from 'fastify'
import { requireRoles } from '../auth/routes.js'
import { CatalogingService, NotFoundError, ValidationError } from './service.js'

/**
 * Ticket 11 — 自动编目 + 审核门 (Seam 2: HTTP/API)。
 * 馆员扫码 ISBN 提交编目建议、审查看建议清单、确认/拒绝入库。未认证 401；管理员越权 403。
 */
export function registerCatalogingRoutes(app: FastifyInstance, cataloging: CatalogingService) {
  const lib = { preHandler: [requireRoles(app, 'librarian')] }

  app.post('/api/cataloging/submit', lib, async (req, reply) => {
    const { isbn } = req.body as { isbn?: string }
    try {
      const suggestion = await cataloging.submit(String(isbn ?? ''))
      return reply.code(201).send({ suggestion })
    } catch (error) {
      return mapCatalogingError(reply, error)
    }
  })

  app.get('/api/cataloging', lib, async () => ({ suggestions: cataloging.list() }))

  app.post('/api/cataloging/:id/approve', lib, async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      const suggestion = cataloging.approve(id)
      return { suggestion, bookId: suggestion.appliedBookId }
    } catch (error) {
      return mapCatalogingError(reply, error)
    }
  })

  app.post('/api/cataloging/:id/reject', lib, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { reason } = req.body as { reason?: string }
    try {
      const suggestion = cataloging.reject(id, typeof reason === 'string' ? reason : undefined)
      return { suggestion }
    } catch (error) {
      return mapCatalogingError(reply, error)
    }
  })
}

function mapCatalogingError(reply: FastifyReply, error: unknown) {
  if (error instanceof ValidationError) return reply.code(422).send({ error: error.message })
  if (error instanceof NotFoundError) return reply.code(404).send({ error: error.message })
  throw error
}