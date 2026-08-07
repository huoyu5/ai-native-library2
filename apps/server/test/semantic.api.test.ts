import { describe, it, expect, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'

/**
 * Ticket 12 — 自然语言检索（Seam 2: HTTP/API）。
 * 注：buildApp 默认走 fake AI provider；fake 返回 "[[fake:...]]" 无法解析 JSON → 自动降级。
 * 此处用 fake provider 验证降级路径；AI 路径在离线评测里覆盖。
 */
describe('natural language search API (Ticket 12, HTTP seam)', () => {
  const app = buildApp()

  beforeAll(async () => {
    // 通过 API 建一些书目供检索
    const lib = (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'librarian', password: 'librarian123' },
      })
    ).json().token

    const t1 = (
      await app.inject({
        method: 'POST',
        url: '/api/titles',
        payload: { title: '夏洛的网', author: 'E.B.怀特', category: '儿童文学', subjects: ['友谊'] },
        headers: { authorization: `Bearer ${lib}` },
      })
    ).json().id
    await app.inject({
      method: 'POST',
      url: `/api/titles/${t1}/copies`,
      payload: { barcode: 'SN-1', shelfLocation: 'A区1排' },
      headers: { authorization: `Bearer ${lib}` },
    })
  })

  it('returns 422 for an empty query', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search/natural?q=' })
    expect(res.statusCode).toBe(422)
  })

  it('is accessible without authentication (anonymous contract)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search/natural?q=夏洛' })
    expect(res.statusCode).toBe(200)
  })

  it('degrades gracefully with fake AI: returns results + degraded=true + mode=keyword', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search/natural?q=有没有儿童故事' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.degraded).toBe(true)
    expect(body.mode).toBe('keyword')
    expect(body.results.length).toBeGreaterThanOrEqual(0)
  })

  it('returns matched result with reasons and availableShelf', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search/natural?q=夏洛' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // 降级 n-gram 路径命中「夏洛」
    const hit = body.results.find((r: { title: string }) => r.title === '夏洛的网')
    expect(hit).toBeTruthy()
    expect(hit.availableShelf).toBe('A区1排')
    expect(hit.reasons.length).toBeGreaterThan(0)
    expect(hit.reasons[0].field).toBeTruthy()
  })
})