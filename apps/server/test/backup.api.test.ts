import { describe, it, expect, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'

/**
 * Ticket 14 — 数据备份与恢复（HTTP seam）。
 * 馆员可全量导出快照、恢复快照（校内服务器数据迁移或灾备恢复）。
 */
describe('backup and restore API (Ticket 14, HTTP seam)', () => {
  const app = buildApp()

  let librarianToken = ''
  let adminToken = ''

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

  it('rejects backup when unauthenticated (401) or as admin (403)', async () => {
    const noAuth = await app.inject({ method: 'GET', url: '/api/backup' })
    expect(noAuth.statusCode).toBe(401)

    const asAdmin = await app.inject({
      method: 'GET',
      url: '/api/backup',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(asAdmin.statusCode).toBe(403)
  })

  it('exports a full snapshot including all domain state', async () => {
    // 创建一些数据
    const reader = await app.inject({
      method: 'POST',
      url: '/api/readers',
      payload: { name: '张三', kind: 'student' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    const readerId = reader.json().id

    const title = await app.inject({
      method: 'POST',
      url: '/api/titles',
      payload: { title: '测试书', subjects: [] },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    const titleId = title.json().id

    await app.inject({
      method: 'POST',
      url: `/api/titles/${titleId}/copies`,
      payload: { barcode: 'BK-1' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })

    await app.inject({
      method: 'POST',
      url: '/api/loans',
      payload: { readerId, barcode: 'BK-1' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/backup',
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(200)
    const { snapshot } = res.json()
    expect(snapshot.version).toBe('1.0')
    expect(snapshot.readers).toHaveLength(1)
    expect(snapshot.catalog.titles).toHaveLength(1)
    expect(snapshot.catalog.copies).toHaveLength(1)
    expect(snapshot.circulation.loans).toHaveLength(1)
  })

  it('restores from snapshot and overwrites existing state', async () => {
    const before = await app.inject({
      method: 'GET',
      url: '/api/backup',
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    const snap = before.json().snapshot

    // 创建新数据后恢复旧快照，新数据应消失
    await app.inject({
      method: 'POST',
      url: '/api/readers',
      payload: { name: '李四', kind: 'teacher' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })

    const restore = await app.inject({
      method: 'POST',
      url: '/api/backup/restore',
      payload: { snapshot: snap },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(restore.statusCode).toBe(200)

    const after = await app.inject({
      method: 'GET',
      url: '/api/readers',
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(after.json().readers).toHaveLength(1)
    expect(after.json().readers[0].name).toBe('张三')
  })

  it('rejects restore without a snapshot (422)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/restore',
      payload: {},
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(422)
  })
})