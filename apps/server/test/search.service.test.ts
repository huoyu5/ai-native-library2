import { describe, it, expect } from 'vitest'
import { ReaderService } from '../src/readers/service.js'
import { CatalogService } from '../src/catalog/service.js'
import { CirculationService } from '../src/circulation/service.js'
import { SearchService } from '../src/search/service.js'

/**
 * Ticket 09 — 公共检索（关键词）(Seam 1: 应用服务公共接口)。
 * 不变量：关键词命中题名元数据；结果含书籍详情、每副本可借状态、架位号。
 * 免登录契约（无 I/O、无鉴权）在 HTTP seam 覆盖。
 */
describe('SearchService (Ticket 09, service seam)', () => {
  const readers = new ReaderService()
  const catalog = new CatalogService()
  const circ = new CirculationService(readers, catalog)
  const search = new SearchService(catalog, circ)

  const now = new Date('2026-03-01T00:00:00Z')

  const t1 = catalog.createTitle({
    title: '二战入门',
    author: '张三',
    isbn: '978-1-1',
    category: '历史',
    subjects: ['历史', '二战'],
  })
  catalog.addCopy(t1.id, { barcode: 'S-1', shelfLocation: 'B区3排' })
  catalog.addCopy(t1.id, { barcode: 'S-2', shelfLocation: 'B区4排' })

  const t2 = catalog.createTitle({ title: '物理之美', author: '李四', subjects: ['科学'] })
  catalog.addCopy(t2.id, { barcode: 'S-3', shelfLocation: 'C区1排' })
  catalog.addCopy(t2.id, { barcode: 'S-4' })

  const studentId = readers.create({ name: '检索读者', kind: 'student' }).id
  // S-1 借出在 1/1（2 周到期 1/15）→ 3/1 已逾期；S-2 借出在 2/20（到期 3/6）→ 借出中
  circ.checkOut(studentId, 'S-1', new Date('2026-01-01T00:00:00Z'))
  circ.checkOut(studentId, 'S-2', new Date('2026-02-20T00:00:00Z'))

  it('matches by title keyword and annotates copy availability', () => {
    const results = search.search('二战', now)
    expect(results).toHaveLength(1)
    const r = results[0]
    expect(r.id).toBe(t1.id)
    expect(r.title).toBe('二战入门')
    expect(r.author).toBe('张三')

    const byBarcode = Object.fromEntries(r.copies.map((c) => [c.barcode, c.status]))
    expect(byBarcode['S-1']).toBe('overdue')
    expect(byBarcode['S-2']).toBe('borrowed')
  })

  it('points the shelf to the first available copy, otherwise first copy', () => {
    const results = search.search('物理', now)
    const r = results[0]
    // S-3 available with a shelf → 指引到 C区1排
    expect(r.availableShelf).toBe('C区1排')
    expect(r.copies.find((c) => c.barcode === 'S-3')?.status).toBe('available')
    expect(r.copies.find((c) => c.barcode === 'S-4')?.status).toBe('available')
  })

  it('falls back to the first copy shelf when none is available', () => {
    const results = search.search('二战', now)
    const r = results[0]
    expect(r.availableShelf).toBe('B区3排') // S-1 逾期，仍给首副本架位
  })

  it('matches against author, isbn, category and subjects', () => {
    expect(search.search('张三', now).map((r) => r.id)).toContain(t1.id)
    expect(search.search('978-1-1', now).map((r) => r.id)).toContain(t1.id)
    expect(search.search('历史', now).map((r) => r.id)).toContain(t1.id)
    expect(search.search('科学', now).map((r) => r.id)).toContain(t2.id)
  })

  it('is case-insensitive for latin keywords', () => {
    expect(search.search('WWII', now)).toEqual([])
    expect(search.search('物理', now)[0].title).toBe('物理之美')
  })

  it('returns an empty list when nothing matches', () => {
    expect(search.search('不存在的书', now)).toEqual([])
  })
})