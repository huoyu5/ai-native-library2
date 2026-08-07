import { describe, it, expect, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'

/**
 * Ticket 08 — 逾期视图与警告 (Seam 2: HTTP/API)。
 * 集成：馆员枚举逾期借阅（可溯 asOf 时间点）；借还响应带读者逾期警告。
 */
describe('overdue list & warning API (Ticket 08, HTTP seam)', () => {
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
      payload: { name: '逾期读者', kind: 'student' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    studentId = reader.json().id

    const title = await app.inject({
      method: 'POST',
      url: '/api/titles',
      payload: { title: '逾期书' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    titleId = title.json().id
    const copy = await app.inject({
      method: 'POST',
      url: `/api/titles/${titleId}/copies`,
      payload: { barcode: 'OD-100' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(copy.statusCode).toBe(201)
  })

  it('denies the overdue list when unauthenticated (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/loans/overdue' })
    expect(res.statusCode).toBe(401)
  })

  it('denies the overdue list to an admin (403, librarian-only)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/loans/overdue',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns an empty overdue list before anything is due', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/loans/overdue',
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().loans).toEqual([])
  })

  it('flaats the reader overdue-warning flag on checkout response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/loans',
      payload: { readerId: studentId, barcode: 'OD-100' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().readerOverdue).toBe(false)
  })

  it('lists the loan as overdue asOf a later date, with reader info', async () => {
    const asOf = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const res = await app.inject({
      method: 'GET',
      url: `/api/loans/overdue?asOf=${encodeURIComponent(asOf)}`,
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(200)
    const loans = res.json().loans
    expect(loans).toHaveLength(1)
    expect(loans[0].barcode).toBe('OD-100')
    expect(loans[0].reader.name).toBe('逾期读者')
    expect(loans[0].reader.id).toBe(studentId)
  })
})