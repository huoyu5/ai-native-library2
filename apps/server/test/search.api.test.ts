import { describe, it, expect, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'

/**
 * Ticket 09 — 公共检索（关键词）(Seam 2: HTTP/API)。
 * 免登录契约：无鉴权可检索；结果含书籍详情、可借状态与架位号。
 */
describe('public search API (Ticket 09, HTTP seam)', () => {
  const app = buildApp()
  let librarianToken = ''

  beforeAll(async () => {
    const lib = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'librarian', password: 'librarian123' },
    })
    librarianToken = lib.json().token

    const title = await app.inject({
      method: 'POST',
      url: '/api/titles',
      payload: { title: '昆虫记', author: '法布尔', subjects: ['自然'], category: '科普' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    const titleId = title.json().id
    await app.inject({
      method: 'POST',
      url: `/api/titles/${titleId}/copies`,
      payload: { barcode: 'SR-1', shelfLocation: 'D区2排' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
  })

  it('requires a query term (422)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search' })
    expect(res.statusCode).toBe(422)
  })

  it('lets an anonymous visitor search without any token (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=%E6%98%86%E8%99%AB' })
    expect(res.statusCode).toBe(200)
    const { results } = res.json()
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('昆虫记')
    expect(results[0].author).toBe('法布尔')
    expect(results[0].category).toBe('科普')
    expect(results[0].subjects).toContain('自然')
  })

  it('annotates copy availability and shelf guidance in results', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=%E8%99%AB' })
    const r = res.json().results[0]
    expect(r.availableShelf).toBe('D区2排')
    expect(r.copies[0]).toMatchObject({ barcode: 'SR-1', status: 'available', shelfLocation: 'D区2排' })
  })

  it('returns an empty list when nothing matches', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=nope-nothing' })
    expect(res.statusCode).toBe(200)
    expect(res.json().results).toEqual([])
  })
})