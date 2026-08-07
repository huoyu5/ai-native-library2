import { describe, it, expect, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'

/**
 * Ticket 10 — AI 供应商抽象层 (Seam 2: HTTP/API)。
 * 集成：受保护 AI 调用端点 + 管理员审计查询；未认证/越权被拒。
 */
describe('AI provider abstraction API (Ticket 10, HTTP seam)', () => {
  const app = buildApp({
    aiConfig: {
      provider: 'fake',
      budget: { timeoutMs: 500, maxOutputTokens: 100, maxCalls: 0 },
    },
  })

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

  it('rejects an AI call when unauthenticated (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/complete',
      payload: { prompt: 'x' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects an AI call for a librarian (403, admin-only)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/complete',
      payload: { prompt: 'x' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejects an AI call without a prompt (422)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/complete',
      payload: {},
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(422)
  })

  it('fulfills an admin AI call and audits it with the operator', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/complete',
      payload: { prompt: '找一本讲二战的入门书' },
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.text).toBeTruthy()
    expect(body.provider).toBe('fake')

    const audit = await app.inject({
      method: 'GET',
      url: '/api/admin/audit',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(audit.statusCode).toBe(200)
    const { entries } = audit.json()
    const found = entries.find((e: { prompt: string }) => e.prompt === '找一本讲二战的入门书')
    expect(found).toBeTruthy()
    expect(found.outcome).toBe('fulfilled')
    expect(found.operatorId).toBe('admin')
    expect(found.provider).toBe('fake')
  })

  it('allows the admin to read the audit log (200)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/audit',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json().entries)).toBe(true)
  })

  it('denies the audit log to a librarian (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/audit',
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('denies the audit log when unauthenticated (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit' })
    expect(res.statusCode).toBe(401)
  })
})