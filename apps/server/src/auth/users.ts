import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Ticket 02 认证 — 内存 seed 用户仓库。
 * 登录用户（管理员/馆员）当前驻留内存，随进程重启而重置；
 * 持久化账号与「管理员创建/停用馆员」在后续系统管理 ticket 接入真实存储。
 */

export type Role = 'librarian' | 'admin'

export interface StoredUser {
  username: string
  role: Role
  /** format: `salt:hash`（scrypt，64 字节 hex） */
  passwordHash: string
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

const seed = () => {
  const users = new Map<string, StoredUser>()
  users.set('admin', { username: 'admin', role: 'admin', passwordHash: hashPassword('admin123') })
  users.set('librarian', { username: 'librarian', role: 'librarian', passwordHash: hashPassword('librarian123') })
  return users
}

let store = seed()

/** 供测试重置 seed（生产同 seed 亦为幂等）。 */
export function resetUsers() {
  store = seed()
}

export function findUser(username: string): StoredUser | undefined {
  return store.get(username)
}

export function isPasswordValid(user: StoredUser, password: string): boolean {
  return verifyPassword(password, user.passwordHash)
}