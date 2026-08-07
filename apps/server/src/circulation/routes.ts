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
      return reply.code(201).send({
        ...loan,
        status: circ.statusOf(loan.id),
        // 办理借出时的读者逾期警告（Ticket 08）
        readerOverdue: circ.hasOverdue(loan.readerId),
      })
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
        return {
          ...loan,
          status: circ.statusOf(loan.id),
          // 办理归还时的读者逾期警告（Ticket 08）
          readerOverdue: circ.hasOverdue(loan.readerId),
        }
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

  // 逾期借阅列表（Ticket 08，spec #17）。馆员可传 asOf 回看某一时刻的逾期快照。
  app.get(
    '/api/loans/overdue',
    { preHandler: [requireRoles(app, 'librarian')] },
    async (req, reply) => {
      const q = req.query as { asOf?: string }
      const asOf = typeof q?.asOf === 'string' && q.asOf.length > 0 ? new Date(q.asOf) : new Date()
      if (Number.isNaN(asOf.getTime())) {
        return reply.code(422).send({ error: 'invalid asOf timestamp' })
      }
      return { loans: circ.overdueLoans(asOf) }
    },
  )
}

function mapCirculationError(reply: FastifyReply, error: unknown) {
  if (error instanceof LoanLimitError) return reply.code(400).send({ error: error.message })
  if (error instanceof CopyUnavailableError) return reply.code(400).send({ error: error.message })
  if (error instanceof NotFoundError) return reply.code(404).send({ error: error.message })
  throw error
}