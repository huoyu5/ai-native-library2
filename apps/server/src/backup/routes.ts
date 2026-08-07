import type { FastifyInstance } from 'fastify'
import { requireRoles } from '../auth/routes.js'
import type { BackupService, BackupSnapshot } from './service.js'

/**
 * Ticket 14 — 数据备份与恢复（HTTP seam）。
 * 馆员可全量导出快照与恢复快照（校内服务器数据迁移或灾备）。
 */
export function registerBackupRoutes(app: FastifyInstance, backup: BackupService) {
  const lib = { preHandler: [requireRoles(app, 'librarian')] }

  app.get('/api/backup', lib, async () => ({ snapshot: backup.snapshot() }))

  app.post('/api/backup/restore', lib, async (req, reply) => {
    const { snapshot } = req.body as { snapshot?: BackupSnapshot }
    if (!snapshot) return reply.code(422).send({ error: 'snapshot is required' })
    backup.restore(snapshot)
    return { message: 'restored' }
  })
}