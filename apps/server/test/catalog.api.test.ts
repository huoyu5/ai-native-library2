import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app.js'

/**
 * Ticket 03 — 题名与副本管理 (Seam 2: HTTP/API)。
 * 集成行为：馆员创建/修正题名、登记副本（条码/架位号），未认证与越权被拒。
 */
describe('catalog API (Ticket 03, HTTP seam)', () => {
  const app = buildApp()

  async function loginAs(username: string, password: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password },
    })
    return res.json().token as string
  }

  async function adminToken() {
    return loginAs('admin', 'admin123')
  }
  async function librarianToken() {
    return loginAs('librarian', 'librarian123')
  }

  it('rejects creating a title when unauthenticated (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/titles',
      payload: { title: '三体' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects an admin from creating a title (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/titles',
      payload: { title: '三体' },
      headers: { authorization: `Bearer ${await adminToken()}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('lets a librarian create a title (201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/titles',
      payload: { title: '三体', author: '刘慈欣', isbn: '9787536692930' },
      headers: { authorization: `Bearer ${await librarianToken()}` },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().title).toBe('三体')
  })

  it('rejects an empty title with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/titles',
      payload: { title: '' },
      headers: { authorization: `Bearer ${await librarianToken()}` },
    })
    expect(res.statusCode).toBe(400)
  })

  it('registers copies with barcode and shelf location under a title (201)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/titles',
      payload: { title: '小王子' },
      headers: { authorization: `Bearer ${await librarianToken()}` },
    })
    const id = created.json().id

    const copyA = await app.inject({
      method: 'POST',
      url: `/api/titles/${id}/copies`,
      payload: { barcode: 'B-500', shelfLocation: 'A区3排' },
      headers: { authorization: `Bearer ${await librarianToken()}` },
    })
    expect(copyA.statusCode).toBe(201)
    expect(copyA.json().shelfLocation).toBe('A区3排')

    const copyB = await app.inject({
      method: 'POST',
      url: `/api/titles/${id}/copies`,
      payload: { barcode: 'B-501' },
      headers: { authorization: `Bearer ${await librarianToken()}` },
    })
    expect(copyB.statusCode).toBe(201)
  })

  it('rejects a duplicate barcode with 400', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/titles',
      payload: { title: '题名X' },
      headers: { authorization: `Bearer ${await librarianToken()}` },
    })
    const id = created.json().id
    await app.inject({
      method: 'POST',
      url: `/api/titles/${id}/copies`,
      payload: { barcode: 'B-DUP' },
      headers: { authorization: `Bearer ${await librarianToken()}` },
    })
    const dup = await app.inject({
      method: 'POST',
      url: `/api/titles/${id}/copies`,
      payload: { barcode: 'B-DUP' },
      headers: { authorization: `Bearer ${await librarianToken()}` },
    })
    expect(dup.statusCode).toBe(400)
  })

  it('lets a librarian fix title metadata via PATCH (200)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/titles',
      payload: { title: '三体', author: '错误作者' },
      headers: { authorization: `Bearer ${await librarianToken()}` },
    })
    const id = created.json().id
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/titles/${id}`,
      payload: { author: '刘慈欣' },
      headers: { authorization: `Bearer ${await librarianToken()}` },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().author).toBe('刘慈欣')
  })

  it('shows one title with all its copies in the detail (200)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/titles',
      payload: { title: '哈利波特' },
      headers: { authorization: `Bearer ${await librarianToken()}` },
    })
    const id = created.json().id
    for (const barcode of ['B-201', 'B-202', 'B-203']) {
      await app.inject({
        method: 'POST',
        url: `/api/titles/${id}/copies`,
        payload: { barcode },
        headers: { authorization: `Bearer ${await librarianToken()}` },
      })
    }
    const detail = await app.inject({
      method: 'GET',
      url: `/api/titles/${id}`,
      headers: { authorization: `Bearer ${await librarianToken()}` },
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().copies.map((c: { barcode: string }) => c.barcode)).toEqual([
      'B-201',
      'B-202',
      'B-203',
    ])
  })

  it('returns 404 for an unknown title id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/titles/nope-missing',
      headers: { authorization: `Bearer ${await librarianToken()}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('lists all titles (200)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/titles',
      headers: { authorization: `Bearer ${await librarianToken()}` },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json().titles)).toBe(true)
  })
})