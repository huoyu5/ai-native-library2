import { describe, it, expect, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'

/**
 * Ticket 13 — 初始建库（批量导入，Seam 2: HTTP/API）。
 * 验证：清单 → 预览（不入库）→ 修正 → 确认入库；权限门与错误映射。
 */
describe('bulk import API (Ticket 13, HTTP seam)', () => {
  const app = buildApp()

  let librarianToken = ''
  let adminToken = ''
  let batchId = ''

  const csv = [
    'isbn,title,author,category,publisher,subjects,barcode,shelfLocation',
    '9787530215737,,,,,,IMP-1,A区1排',
    '9787530215737,,,,,,IMP-2,A区1排',
    ',导入的书,某作者,文学,某社,主题A|主题B,IMP-3,B区2排',
    ',,,,,,IMP-4,C区',
  ].join('\n')

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

  it('rejects preview when unauthenticated (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/import/preview', payload: { csv } })
    expect(res.statusCode).toBe(401)
  })

  it('rejects an admin from importing (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/preview',
      payload: { csv },
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('previews the sheet: titles/copies suggested, nothing in the catalog yet (201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/preview',
      payload: { csv },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(201)
    const { batch } = res.json()
    batchId = batch.id
    expect(batch.status).toBe('preview')
    expect(batch.summary).toEqual({ total: 3, ready: 2, invalid: 1 })

    // 外部书目补全的题名，来源标注 external
    const charlotte = batch.rows.find((r: { fields: { title?: string } }) => r.fields.title === '夏洛的网')
    expect(charlotte.copies).toHaveLength(2)
    expect(charlotte.fieldSources.title).toBe('external')

    // 预览阶段不进入公共检索
    const pub = await app.inject({ method: 'GET', url: '/api/search?q=夏洛' })
    expect(pub.json().results).toHaveLength(0)
  })

  it('corrects the invalid row via the API (200)', async () => {
    const preview = await app.inject({
      method: 'GET',
      url: `/api/import/${batchId}`,
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    const rows = preview.json().batch.rows as Array<{ status: string }>
    const index = rows.findIndex((r) => r.status === 'invalid')

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/import/${batchId}/rows/${index}`,
      payload: { title: '手工补的题名' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(200)
    const { batch } = res.json()
    expect(batch.summary).toEqual({ total: 3, ready: 3, invalid: 0 })
    expect(batch.rows[index].fieldSources.title).toBe('manual')
  })

  it('commits the batch and makes the holdings searchable (200)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/import/${batchId}/commit`,
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().result).toEqual({ titlesCreated: 3, copiesCreated: 4 })

    const pub = await app.inject({ method: 'GET', url: '/api/search?q=夏洛' })
    const hit = pub.json().results[0]
    expect(hit.title).toBe('夏洛的网')
    expect(hit.copies).toHaveLength(2)
    expect(hit.availableShelf).toBe('A区1排')
  })

  it('returns 404 for an unknown batch and 422 for an empty sheet', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/api/import/nope/commit',
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(missing.statusCode).toBe(404)

    const empty = await app.inject({
      method: 'POST',
      url: '/api/import/preview',
      payload: { csv: '   ' },
      headers: { authorization: `Bearer ${librarianToken}` },
    })
    expect(empty.statusCode).toBe(422)
  })
})