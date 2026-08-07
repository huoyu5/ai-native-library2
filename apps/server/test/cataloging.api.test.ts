import { describe, it, expect, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'

/**
 * Ticket 11 — 自动编目 + 审核门 (Seam 2: HTTP/API，外部书目以 mock 集成)。
 */
describe('cataloging API (Ticket 11, HTTP seam)', () => {
  const app = buildApp()

  let adminToken = ''
  let librarianToken = ''
  let suggestionId = ''

  beforeAll(async () => {
    const lib = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'librarian', password: 'librarian123' },
    })
    librarianToken = lib.json().token
    const adm = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin123' },
    })
    adminToken = adm.json().token
  })

  it('rejects submit when unauthenticated (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cataloging/submit',
      payload: { isbn: '9787530215737' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects an admin from cataloging (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cataloging/submit',
      payload: { isbn: '9787530215737' },
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('submits an ISBN and returns a pending suggestion tagged with source=external (201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cataloging/submit',
      payload: { isbn: '9787530215737' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(201)
    const { suggestion } = res.json()
    suggestionId = suggestion.id
    expect(suggestion.status).toBe('pending')
    expect(suggestion.fields.title).toBe('夏洛的网')
    expect(suggestion.fields.author).toBe('E.B.怀特')
    expect(suggestion.fields.isbn).toBeUndefined() // 外部字段不强制
    expect(suggestion.fieldSources.title).toBe('external')
    expect(suggestion.fieldSources.author).toBe('external')
  })

  it('is not searchable in catalog until approved (audit gate via API)', async () => {
    const pub = await app.inject({ method: 'GET', url: '/api/search?q=夏洛' })
    expect(pub.statusCode).toBe(200)
    const found = (pub.json().results ?? []).some(
      (r: { title: string }) => r.title === '夏洛的网',
    )
    expect(found).toBe(false)
  })

  it('approve commits to catalog and makes it searchable (200)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/cataloging/${suggestionId}/approve`,
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(200)
    const { bookId } = res.json()
    expect(bookId).toBeTruthy()

    const pub = await app.inject({ method: 'GET', url: '/api/search?q=夏洛' })
    const found = (pub.json().results ?? []).filter(
      (r: { title: string }) => r.title === '夏洛的网',
    )
    expect(found.length).toBe(1)
    expect(found[0].subjects).toContain('童话')
  })

  it('rejects a suggestion and keeps it out of the catalog (200)', async () => {
    const sub = await app.inject({
      method: 'POST',
      url: '/api/cataloging/submit',
      payload: { isbn: '9787506365437' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    const badId = sub.json().suggestion.id

    const rejectRes = await app.inject({
      method: 'POST',
      url: `/api/cataloging/${badId}/reject`,
      payload: { reason: '信息有误' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(rejectRes.statusCode).toBe(200)
    expect(rejectRes.json().suggestion.status).toBe('rejected')

    const pub = await app.inject({ method: 'GET', url: '/api/search?q=活着' })
    const found = (pub.json().results ?? []).filter((r: { title: string }) => r.title === '活着')
    expect(found.length).toBe(0)
  })

  it('lists all cataloging suggestions (200)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/cataloging',
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().suggestions.length).toBeGreaterThanOrEqual(2)
  })

  it('returns 422 for an empty ISBN on submit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cataloging/submit',
      payload: { isbn: '   ' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(422)
  })
})