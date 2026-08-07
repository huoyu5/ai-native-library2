import { describe, it, expect, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { DEFAULT_LOAN_POLICY } from '../src/policy/service.js'

/**
 * Ticket 06 — 借阅政策可配置 (Seam 2: HTTP/API)。
 * 集成：管理员读取/更新政策；未认证与越权被拒；非法参数 422。
 */
describe('loan policy API (Ticket 06, HTTP seam)', () => {
  const app = buildApp()

  let adminToken = ''
  let librarianToken = ''

  beforeAll(async () => {
    const adm = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin123' },
    })
    adminToken = adm.json().token
    const lib = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'librarian', password: 'librarian123' },
    })
    librarianToken = lib.json().token
  })

  it('returns the default policy to the admin (200)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/loan-policy',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().policy).toEqual(DEFAULT_LOAN_POLICY)
  })

  it('updates a subset of policy parameters (200)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/loan-policy',
      payload: { renewalsAhead: 2 },
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    const policy = res.json().policy
    expect(policy.renewalsAhead).toBe(2)
    expect(policy.maxActiveLoansPerReader).toBe(DEFAULT_LOAN_POLICY.maxActiveLoansPerReader)
  })

  it('rejects invalid policy values (422)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/loan-policy',
      payload: { maxActiveLoansPerReader: 0 },
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(422)
  })

  it('rejects an empty patch (422)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/loan-policy',
      payload: {},
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(422)
  })

  it('denies policy changes to a librarian (403)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/loan-policy',
      payload: { renewalsAhead: 3 },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('denies reading the policy when unauthenticated (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/loan-policy' })
    expect(res.statusCode).toBe(401)
  })
})