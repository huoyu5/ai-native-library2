import type { FastifyInstance, FastifyReply } from 'fastify'
import { requireRoles } from '../auth/routes.js'
import {
  CirculationService,
  CopyUnavailableError,
  LoanLimitError,
  NotFoundError,
} from './service.js'

/**
 * Ticket 05 — 个人借阅闭环 (Seam 2: HTTP/API)。
 * 馆员业务操作：借出、归还、查看借阅/状态。未认证 401；管理员越权 403。
 */

export function registerCirculationRoutes(app: FastifyInstance, circ: CirculationService) {
  app.post('/api/loans', { preHandler: [requireRoles(app, 'librarian')] }, async (req, reply) => {
    const { readerId, barcode } = req.body as { readerId?: string; barcode?: string }
    try {
      const loan = circ.checkOut(String(readerId ?? ''), String(barcode ?? ''))
      return reply.code(201).send({ ...loan, status: circ.statusOf(loan.id) })
    } catch (error) {
      return mapCirculationError(reply, error)
    }
  })

  app.post(
    '/api/loans/return',
    { preHandler: [requireRoles(app, 'librarian')] },
    async (req, reply) => {
      const { barcode } = req.body as { barcode?: string }
      try {
        const loan = circ.returnCopy(String(barcode ?? ''))
        return { ...loan, status: circ.statusOf(loan.id) }
      } catch (error) {
        return mapCirculationError(reply, error)
      }
    },
  )

  app.get(
    '/api/loans/reader/:readerId',
    { preHandler: [requireRoles(app, 'librarian')] },
    async (req) => {
      const { readerId } = req.params as { readerId: string }
      const loans = circ.activeLoansOf(readerId).map((l) => ({ ...l, status: circ.statusOf(l.id) }))
      return { loans }
    },
  )

  app.get('/api/loans', { preHandler: [requireRoles(app, 'librarian')] }, async () => ({
    loans: circ.allLoans().map((l) => ({ ...l, status: circ.statusOf(l.id) })),
  }))
}

function mapCirculationError(reply: FastifyReply, error: unknown) {
  if (error instanceof LoanLimitError) return reply.code(400).send({ error: error.message })
  if (error instanceof CopyUnavailableError) return reply.code(400).send({ error: error.message })
  if (error instanceof NotFoundError) return reply.code(404).send({ error: error.message })
  throw error
}