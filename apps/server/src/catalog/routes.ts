import type { FastifyInstance } from 'fastify'
import { requireRoles } from '../auth/routes.js'
import {
  CatalogService,
  ValidationError,
  NotFoundError,
  type CreateTitleInput,
  type UpdateTitleInput,
  type AddCopyInput,
} from './service.js'

/**
 * Ticket 03 — 题名与副本管理 (Seam 2: HTTP/API)。
 * 馆员业务操作：题名 CRUD + 副本登记。未认证 401；管理员越权 403。
 */

export function registerCatalogRoutes(app: FastifyInstance, catalog: CatalogService) {
  app.post('/api/titles', { preHandler: [requireRoles(app, 'librarian')] }, async (req, reply) => {
    try {
      const title = catalog.createTitle(req.body as CreateTitleInput)
      return reply.code(201).send(title)
    } catch (error) {
      if (error instanceof ValidationError) return reply.code(400).send({ error: error.message })
      throw error
    }
  })

  app.get('/api/titles', { preHandler: [requireRoles(app, 'librarian')] }, async () => ({
    titles: catalog.listTitles(),
  }))

  app.get(
    '/api/titles/:id',
    { preHandler: [requireRoles(app, 'librarian')] },
    async (req, reply) => {
      const detail = catalog.getTitleDetail((req.params as { id: string }).id)
      if (!detail) return reply.code(404).send({ error: 'title not found' })
      return detail
    },
  )

  app.patch(
    '/api/titles/:id',
    { preHandler: [requireRoles(app, 'librarian')] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id
      try {
        return catalog.updateTitle(id, req.body as UpdateTitleInput)
      } catch (error) {
        if (error instanceof NotFoundError) return reply.code(404).send({ error: error.message })
        if (error instanceof ValidationError) return reply.code(400).send({ error: error.message })
        throw error
      }
    },
  )

  app.post(
    '/api/titles/:id/copies',
    { preHandler: [requireRoles(app, 'librarian')] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id
      try {
        const copy = catalog.addCopy(id, req.body as AddCopyInput)
        return reply.code(201).send(copy)
      } catch (error) {
        if (error instanceof NotFoundError) return reply.code(404).send({ error: error.message })
        if (error instanceof ValidationError) return reply.code(400).send({ error: error.message })
        throw error
      }
    },
  )
}