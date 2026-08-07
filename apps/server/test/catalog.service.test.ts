import { describe, it, expect } from 'vitest'
import { CatalogService, ValidationError, NotFoundError } from '../src/catalog/service.js'

/**
 * Ticket 03 — 题名与副本管理 (Seam 1: 应用服务公共接口)。
 * 领域行为：题名创建/修正、副本登记（条码/架位号）、一题多副本。
 * 元数据采用简化字段（ADR-0001）：题名、作者、ISBN、分类、主题、出版信息。
 */
describe('CatalogService (Ticket 03, service seam)', () => {
  const catalog = new CatalogService()

  it('creates a title with simplified metadata', () => {
    const title = catalog.createTitle({
      title: '三体',
      author: '刘慈欣',
      isbn: '9787536692930',
      category: '科幻',
      subjects: ['科幻', '外星文明'],
      publisher: '重庆出版社',
    })
    expect(title.id).toBeTypeOf('string')
    expect(title.title).toBe('三体')
    expect(title.author).toBe('刘慈欣')
    expect(title.isbn).toBe('9787536692930')
    expect(title.subjects).toEqual(['科幻', '外星文明'])
  })

  it('rejects a title without a name', () => {
    expect(() => catalog.createTitle({ title: '' })).toThrow(ValidationError)
  })

  it('registers multiple copies against one title with barcode and shelf location', () => {
    const title = catalog.createTitle({ title: '小王子' })
    const copyA = catalog.addCopy(title.id, { barcode: 'B-001', shelfLocation: 'A区3排' })
    const copyB = catalog.addCopy(title.id, { barcode: 'B-002', shelfLocation: 'A区3排' })

    expect(copyA.barcode).toBe('B-001')
    expect(copyA.shelfLocation).toBe('A区3排')
    expect(copyA.titleId).toBe(title.id)
    expect(copyB.id).not.toBe(copyA.id)
  })

  it('rejects a duplicate barcode globally', () => {
    const t1 = catalog.createTitle({ title: '题名一' })
    const t2 = catalog.createTitle({ title: '题名二' })
    catalog.addCopy(t1.id, { barcode: 'B-100' })
    expect(() => catalog.addCopy(t2.id, { barcode: 'B-100' })).toThrow(ValidationError)
  })

  it('rejects a copy for an unknown title', () => {
    expect(() => catalog.addCopy('nope', { barcode: 'B-999' })).toThrow(NotFoundError)
  })

  it('updates title metadata (fixing an error)', () => {
    const title = catalog.createTitle({ title: '三体', author: '错误作者' })
    const updated = catalog.updateTitle(title.id, { author: '刘慈欣' })
    expect(updated.author).toBe('刘慈欣')
    expect(updated.title).toBe('三体')
  })

  it('throws NotFound when updating an unknown title', () => {
    expect(() => catalog.updateTitle('nope', { author: 'x' })).toThrow(NotFoundError)
  })

  it('shows all copies in the title detail (one title, many copies)', () => {
    const title = catalog.createTitle({ title: '哈利波特' })
    catalog.addCopy(title.id, { barcode: 'B-201', shelfLocation: 'B区1排' })
    catalog.addCopy(title.id, { barcode: 'B-202', shelfLocation: 'B区1排' })
    catalog.addCopy(title.id, { barcode: 'B-203', shelfLocation: 'B区1排' })

    const detail = catalog.getTitleDetail(title.id)
    expect(detail?.title).toBe('哈利波特')
    expect(detail?.copies).toHaveLength(3)
    expect(detail?.copies.map((c) => c.barcode)).toEqual(['B-201', 'B-202', 'B-203'])
  })

  it('lists all titles', () => {
    catalog.createTitle({ title: '活着' })
    expect(catalog.listTitles().length).toBeGreaterThanOrEqual(1)
  })
})