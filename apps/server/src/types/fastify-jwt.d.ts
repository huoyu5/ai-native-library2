import type { Role } from '../auth/users.js'

/**
 * JWT 载荷/用户类型增强（@fastify/jwt）。
 * 登录时签发的 token 承载身份与角色，受保护 handler 经 `request.user` 读取。
 */
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: Role }
    user: { sub: string; role: Role }
  }
}