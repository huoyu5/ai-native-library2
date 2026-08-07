import type { FastifyInstance } from 'fastify'
import { requireRoles } from '../auth/routes.js'
import { ReaderService, ValidationError, type CreateReaderInput } from './service.js'

/**
 * Ticket 04 — 读者管理 (Seam 2: HTTP/API)。
 * 馆员业务操作：POST/GET /api/readers。未认证 401；管理员越权 403。
 */
export function registerReaderRoutes(app: FastifyInstance, service: ReaderService) {
  app.post('/api/readers', { preHandler: [requireRoles(app, 'librarian')] }, async (req, reply) => {
    const input = req.body as CreateReaderInput
    try {
      const reader = service.create(input)
      return reply.code(201).send(reader)
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.code(400).send({ error: error.message })
      }
      throw error
    }
  })

  app.get('/api/readers', { preHandler: [requireRoles(app, 'librarian')] }, async () => ({
    readers: service.list(),
  }))

  app.get(
    '/api/readers/:id',
    { preHandler: [requireRoles(app, 'librarian')] },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const reader = service.findById(id)
      if (!reader) return reply.code(404).send({ error: 'reader not found' })
      return reader
    },
  )
}