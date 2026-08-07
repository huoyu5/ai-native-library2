import type { FastifyInstance } from 'fastify'
import { requireRoles } from '../auth/routes.js'
import { LoanPolicyService, PolicyValidationError, type LoanPolicy } from './service.js'

/**
 * 借阅政策 HTTP seam（Ticket 06，Seam 2）。
 * - GET   /api/admin/loan-policy — 读取当前政策（系统管理员）
 * - PATCH /api/admin/loan-policy — 部分更新政策参数，实时生效于借出校验
 */
export function registerLoanPolicyRoutes(app: FastifyInstance, service: LoanPolicyService) {
  app.get('/api/admin/loan-policy', { preHandler: [requireRoles(app, 'admin')] }, async () => ({
    policy: service.get(),
  }))

  app.patch('/api/admin/loan-policy', { preHandler: [requireRoles(app, 'admin')] }, async (req, reply) => {
    const body = req.body as Partial<LoanPolicy> | undefined
    const patch: Partial<LoanPolicy> = {
      maxActiveLoansPerReader: numOrUndefined(body?.maxActiveLoansPerReader),
      renewalsAhead: numOrUndefined(body?.renewalsAhead),
      loanWeeksByReaderKind: body?.loanWeeksByReaderKind ?? undefined,
    }
    if (Object.keys(patch).every((k) => (patch as Record<string, unknown>)[k] === undefined)) {
      return reply.code(422).send({ error: 'no loan-policy field provided' })
    }
    try {
      const updated = service.update(patch)
      return { policy: updated }
    } catch (err) {
      if (err instanceof PolicyValidationError) {
        return reply.code(422).send({ error: err.message })
      }
      throw err
    }
  })
}

function numOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}