import type { FastifyInstance, FastifyReply } from 'fastify'
import { requireRoles } from '../auth/routes.js'
import { ImportService, NotFoundError, ValidationError } from './service.js'
import type { SuggestionFields } from '../cataloging/service.js'

/**
 * Ticket 13 — 初始建库（批量导入，Seam 2: HTTP/API）。
 * 馆员上传清单 → 预览（不入库）→ 逐行修正 → 确认入库 / 放弃。未认证 401；管理员越权 403。
 */
export function registerImportRoutes(app: FastifyInstance, imports: ImportService) {
  const lib = { preHandler: [requireRoles(app, 'librarian')] }

  app.post('/api/import/preview', lib, async (req, reply) => {
    const { csv } = req.body as { csv?: string }
    try {
      const batch = await imports.preview(String(csv ?? ''))
      return reply.code(201).send({ batch })
    } catch (error) {
      return mapImportError(reply, error)
    }
  })

  app.get('/api/import', lib, async () => ({ batches: imports.list() }))

  app.get('/api/import/:id', lib, async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      return { batch: imports.get(id) }
    } catch (error) {
      return mapImportError(reply, error)
    }
  })

  app.patch('/api/import/:id/rows/:index', lib, async (req, reply) => {
    const { id, index } = req.params as { id: string; index: string }
    const patch = (req.body ?? {}) as SuggestionFields
    try {
      const batch = imports.correctRow(id, Number(index), patch)
      return { batch }
    } catch (error) {
      return mapImportError(reply, error)
    }
  })

  app.post('/api/import/:id/commit', lib, async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      const batch = imports.commit(id)
      return { batch, result: batch.result }
    } catch (error) {
      return mapImportError(reply, error)
    }
  })

  app.post('/api/import/:id/discard', lib, async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      return { batch: imports.discard(id) }
    } catch (error) {
      return mapImportError(reply, error)
    }
  })
}

function mapImportError(reply: FastifyReply, error: unknown) {
  if (error instanceof ValidationError) return reply.code(422).send({ error: error.message })
  if (error instanceof NotFoundError) return reply.code(404).send({ error: error.message })
  throw error
}