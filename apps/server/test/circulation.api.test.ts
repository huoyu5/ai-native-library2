import { describe, it, expect, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'

/**
 * Ticket 05 — 个人借阅闭环 (Seam 2: HTTP/API)。
 * 集成：馆员借出/归还/查询；未认证与越权被拒；政策边界与错误映射。
 */
describe('circulation API (Ticket 05, HTTP seam)', () => {
  const app = buildApp()

  let librarianToken = ''
  let adminToken = ''
  let studentId = ''
  let titleId = ''

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

    const reader = await app.inject({
      method: 'POST',
      url: '/api/readers',
      payload: { name: '借阅学生', kind: 'student' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    studentId = reader.json().id

    const title = await app.inject({
      method: 'POST',
      url: '/api/titles',
      payload: { title: '科借阅书' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    titleId = title.json().id
    for (const b of ['C-101', 'C-102', 'C-103']) {
      await app.inject({
        method: 'POST',
        url: `/api/titles/${titleId}/copies`,
        payload: { barcode: b },
        headers: { authorization: `Bearer ${librarianToken}` },
      })
    }
  })

  it('rejects checkout when unauthenticated (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/loans',
      payload: { readerId: studentId, barcode: 'C-101' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects an admin from checking out (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/loans',
      payload: { readerId: studentId, barcode: 'C-101' },
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('checks out a copy to the reader and records loan info (201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/loans',
      payload: { readerId: studentId, barcode: 'C-101' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.barcode).toBe('C-101')
    expect(body.readerId).toBe(studentId)
    expect(body.status).toBe('active')
    expect(body.dueAt).toBeTruthy()
    expect(body.loanedAt).toBeTruthy()
  })

  it('rejects checking out a copy already on loan (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/loans',
      payload: { readerId: studentId, barcode: 'C-101' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for an unknown barcode on checkout', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/loans',
      payload: { readerId: studentId, barcode: 'C-NOPE' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('lists a reader current loans (200)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/loans/reader/${studentId}`,
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(200)
    const barcodes = res.json().loans.map((l: { barcode: string }) => l.barcode)
    expect(barcodes).toContain('C-101')
  })

  it('returns a copy and lets it be checked out again via the API (200/201)', async () => {
    const returned = await app.inject({
      method: 'POST',
      url: '/api/loans/return',
      payload: { barcode: 'C-101' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(returned.statusCode).toBe(200)
    expect(returned.json().status).toBe('returned')

    const again = await app.inject({
      method: 'POST',
      url: '/api/loans',
      payload: { readerId: studentId, barcode: 'C-101' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(again.statusCode).toBe(201)
  })
})