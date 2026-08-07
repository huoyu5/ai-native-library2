import { describe, it, expect, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'

/**
 * Ticket 07 — 续借 + 班级套书 (Seam 2: HTTP/API)。
 */
describe('renewal & class-set API (Ticket 07, HTTP seam)', () => {
  const app = buildApp()

  let adminToken = ''
  let librarianToken = ''
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
      payload: { name: '续借学生', kind: 'student' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    studentId = reader.json().id

    const title = await app.inject({
      method: 'POST',
      url: '/api/titles',
      payload: { title: '续借之书' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    titleId = title.json().id
    for (const b of ['RN-100', 'RN-101', 'RN-102']) {
      await app.inject({
        method: 'POST',
        url: `/api/titles/${titleId}/copies`,
        payload: { barcode: b },
        headers: { authorization: `Bearer ${librarianToken}` },
      })
    }
  })

  describe('renewal endpoint', () => {
    it('rejects unauthenticated renewal (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/loans/renew',
        payload: { barcode: 'RN-100' },
      })
      expect(res.statusCode).toBe(401)
    })

    it('rejects an admin from renewing (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/loans/renew',
        payload: { barcode: 'RN-100' },
        headers: { authorization: `Bearer ${adminToken}` },
      })
      expect(res.statusCode).toBe(403)
    })

    it('renews an active loan once and rejects the second renewal (200 then 400)', async () => {
      const checkout = await app.inject({
        method: 'POST',
        url: '/api/loans',
        payload: { readerId: studentId, barcode: 'RN-100' },
        headers: { authorization: `Bearer ${librarianToken}` },
      })
      expect(checkout.statusCode).toBe(201)

      const renewed = await app.inject({
        method: 'POST',
        url: '/api/loans/renew',
        payload: { barcode: 'RN-100' },
        headers: { authorization: `Bearer ${librarianToken}` },
      })
      expect(renewed.statusCode).toBe(200)
      expect(renewed.json().renewCount).toBe(1)
      expect(renewed.json().status).toBe('active')
      expect(new Date(renewed.json().dueAt).getTime()).toBeGreaterThan(
        new Date(checkout.json().dueAt).getTime(),
      )

      const again = await app.inject({
        method: 'POST',
        url: '/api/loans/renew',
        payload: { barcode: 'RN-100' },
        headers: { authorization: `Bearer ${librarianToken}` },
      })
      expect(again.statusCode).toBe(400)
    })

    it('returns 404 when renewing a barcode without an active loan', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/loans/renew',
        payload: { barcode: 'RN-NOPE' },
        headers: { authorization: `Bearer ${librarianToken}` },
      })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('class-set endpoint', () => {
    it('checks out a batch of copies to a class with a semester due date (201)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/loans/class-set',
        payload: { className: '三年二班', barcodes: ['RN-101', 'RN-102'] },
        headers: { authorization: `Bearer ${librarianToken}` },
      })
      expect(res.statusCode).toBe(201)
      const loans = res.json().loans as Array<{
        barcode: string
        kind: string
        className: string
        renewCount: number
      }>
      expect(loans).toHaveLength(2)
      for (const loan of loans) {
        expect(loan.kind).toBe('class')
        expect(loan.className).toBe('三年二班')
        expect(loan.renewCount).toBe(0)
      }
      expect(loans[0].barcode).toBe('RN-101')
      expect(loans[1].barcode).toBe('RN-102')
    })

    it('rejects an empty barcode list (422)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/loans/class-set',
        payload: { className: '三年二班', barcodes: [] },
        headers: { authorization: `Bearer ${librarianToken}` },
      })
      expect(res.statusCode).toBe(422)
    })

    it('rejects a batch that includes a copy already on loan (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/loans/class-set',
        payload: { className: '四年一班', barcodes: ['RN-101', 'RN-100'] },
        headers: { authorization: `Bearer ${librarianToken}` },
      })
      expect(res.statusCode).toBe(400)
    })

    it('rejects a batch that includes an unknown copy (404)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/loans/class-set',
        payload: { className: '四年一班', barcodes: ['RN-NOPE'] },
        headers: { authorization: `Bearer ${librarianToken}` },
      })
      expect(res.statusCode).toBe(404)
    })
  })
})