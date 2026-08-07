import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { findUser, isPasswordValid, type Role } from './users.js'

/**
 * 认证与角色路由 (Ticket 02, Seam 2: HTTP/API)。
 * - POST /api/auth/login  — 校验凭据，成功签发 JWT（Bearer token）
 * - GET  /api/auth/me     — 回显当前身份（受保护，需 Bearer token）
 */
export function registerAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const body = req.body as { username?: string; password?: string }
    const username = typeof body?.username === 'string' ? body.username : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const user = findUser(username)
    if (!user || !isPasswordValid(user, password)) {
      return reply.code(401).send({ error: 'invalid credentials' })
    }
    const token = app.jwt.sign({ sub: user.username, role: user.role })
    return { token, role: user.role }
  })

  app.get('/api/auth/me', { preHandler: [requireRoles(app)] }, async (req) => {
    const { sub, role } = req.user
    return { username: sub, role }
  })
}

/**
 * 角色闸门 preHandler：
 * - 无/无效 Bearer token → 401
 * - token 有效但角色不在 allowed → 403（同角色闸门可设角色门）
 */
export function requireRoles(app: FastifyInstance, ...allowed: Role[]) {
  return async function roleGuard(req: FastifyRequest, reply: FastifyReply) {
    const user = getJwtUser(app, req)
    if (!user) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    req.user = user
    if (allowed.length > 0 && !allowed.includes(user.role)) {
      return reply.code(403).send({ error: 'forbidden' })
    }
  }
}

function getJwtUser(
  app: FastifyInstance,
  req: FastifyRequest,
): { sub: string; role: Role } | null {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length)
  try {
    return app.jwt.verify<{ sub: string; role: Role }>(token)
  } catch {
    return null
  }
}