import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { registerAuthRoutes, requireRoles } from './auth/routes.js'

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

  return app
}
