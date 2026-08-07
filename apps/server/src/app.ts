import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { registerAuthRoutes, requireRoles } from './auth/routes.js'
import { ReaderService } from './readers/service.js'
import { registerReaderRoutes } from './readers/routes.js'
import { CatalogService } from './catalog/service.js'
import { registerCatalogRoutes } from './catalog/routes.js'
import { CirculationService } from './circulation/service.js'
import { registerCirculationRoutes } from './circulation/routes.js'

/**
 * Builds the Fastify application without listening, so tests can use `app.inject`.
 * The HTTP/API seam lives here: all future API routes register onto this app.
 */
export function buildApp(opts?: { jwtSecret?: string }) {
  const app = Fastify({ logger: false })

  // JWT sign/verify (Ticket 02). Secret from env or a dev fallback.
  app.register(jwt, {
    secret: opts?.jwtSecret ?? process.env.JWT_SECRET ?? 'dev-secret-not-for-production',
  })

  app.get('/health', async () => ({ status: 'ok' }))

  // 认证与角色 (Ticket 02)
  registerAuthRoutes(app)

  // 受保护占位路由 —— 角色门（Seam 2 权限校验）。
  // 业务操作仅馆员；系统管理仅管理员；二者互斥（spec 角色矩阵）。
  app.get('/api/staff/loans', { preHandler: [requireRoles(app, 'librarian')] }, async () => ({
    loans: [],
  }))

  app.get('/api/admin/users', { preHandler: [requireRoles(app, 'admin')] }, async () => ({
    users: [],
  }))

  // 领域服务（内存驻留，各服务共享实例；后续 ticket 接入真实持久化）
  const readers = new ReaderService()
  const catalog = new CatalogService()
  const circulation = new CirculationService(readers, catalog)

  // 读者管理 (Ticket 04) —— 馆员业务操作（应用服务 seam + HTTP seam）
  registerReaderRoutes(app, readers)

  // 题名与副本管理 (Ticket 03) —— 目录基础（ADR-0001 简化元数据）
  registerCatalogRoutes(app, catalog)

  // 个人借阅闭环 (Ticket 05)
  registerCirculationRoutes(app, circulation)

  return app
}
