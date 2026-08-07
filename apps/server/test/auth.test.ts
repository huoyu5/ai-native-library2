import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app.js'

const app = buildApp()

/**
 * Ticket 02 — 认证与角色 (Seam 2: HTTP/API)。
 * 场景：登录 / 未认证拒 / 角色门。
 */
describe('authentication (Ticket 02)', () => {
  it('returns 401 for a protected route without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(res.statusCode).toBe(401)
  })

  it('logs in the seeded admin with the admin role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin123' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.role).toBe('admin')
    expect(typeof body.token).toBe('string')
  })

  it('logs in the seeded librarian with the librarian role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'librarian', password: 'librarian123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().role).toBe('librarian')
  })

  it('rejects a wrong password with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'wrong-secret' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects an unknown user with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'nobody', password: 'whatever' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('exposes the caller identity through /api/auth/me with a valid token', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'librarian', password: 'librarian123' },
    })
    const { token } = login.json()
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toEqual({ username: 'librarian', role: 'librarian' })
  })
})

describe('role gates (Ticket 02)', () => {
  async function loginAs(username: string, password: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password },
    })
    return res.json().token as string
  }

  it('denies an unauthenticated visitor from staff business routes (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/staff/loans' })
    expect(res.statusCode).toBe(401)
  })

  it('denies an unauthenticated visitor from admin system routes (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/users' })
    expect(res.statusCode).toBe(401)
  })

  it('lets a librarian access staff business routes (200)', async () => {
    const token = await loginAs('librarian', 'librarian123')
    const res = await app.inject({
      method: 'GET',
      url: '/api/staff/loans',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('lets an admin access admin system routes (200)', async () => {
    const token = await loginAs('admin', 'admin123')
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('rejects a librarian from admin system routes (403)', async () => {
    const token = await loginAs('librarian', 'librarian123')
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejects an admin from staff business routes (403)', async () => {
    const token = await loginAs('admin', 'admin123')
    const res = await app.inject({
      method: 'GET',
      url: '/api/staff/loans',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('keeps the anonymous public health route open (200, no token)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
  })

  it('rejects a tampered/invalid token on a protected route (401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/staff/loans',
      headers: { authorization: 'Bearer not-a-valid-jwt' },
    })
    expect(res.statusCode).toBe(401)
  })
})