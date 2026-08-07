import { describe, it, expect } from 'vitest'
import { CatalogService } from '../src/catalog/service.js'
import { CatalogingService, type CatalogBibProvider } from '../src/cataloging/service.js'
import { ImportService, ValidationError, NotFoundError } from '../src/import/service.js'

/**
 * Ticket 13 — 初始建库（批量导入，Seam 1）。
 * 不变量：清单 → 题名/副本建议（预览不入库）；预览可修正；确认后才入库；同 ISBN 多行合并为一题多副本。
 */
const BIB: CatalogBibProvider = {
  async lookup(isbn) {
    if (isbn === '9787530215737') {
      return { title: '夏洛的网', author: 'E.B.怀特', category: '儿童文学', subjects: ['童话'] }
    }
    return undefined
  },
}

function build() {
  const catalog = new CatalogService()
  const cataloging = new CatalogingService({
    bib: BIB,
    aiFill: async () => ({}), // 离线：AI 不补，验证纯清单 + 外部书目路径
    catalog,
  })
  const imports = new ImportService({ cataloging, catalog })
  return { imports, catalog }
}

const CSV = [
  'isbn,title,author,category,publisher,subjects,barcode,shelfLocation',
  '9787530215737,,,,,,A-1,A区1排',
  '9787530215737,,,,,,A-2,A区1排',
  ',自带题名,某作者,文学,某社,主题1|主题2,B-1,B区',
  ',,,,,,C-1,C区',
].join('\n')

describe('bulk import (Ticket 13, service seam)', () => {
  it('previews titles/copies from the sheet without writing to the catalog', async () => {
    const { imports, catalog } = build()
    const batch = await imports.preview(CSV)

    expect(batch.status).toBe('preview')
    expect(batch.summary).toEqual({ total: 3, ready: 2, invalid: 1 })
    expect(catalog.listTitles()).toHaveLength(0) // 预览不入库

    const charlotte = batch.rows.find((r) => r.fields.title === '夏洛的网')
    expect(charlotte?.lines).toEqual([2, 3]) // 同 ISBN 两行合并为一题两副本
    expect(charlotte?.copies.map((c) => c.barcode)).toEqual(['A-1', 'A-2'])
    expect(charlotte?.fieldSources.title).toBe('external')

    const manual = batch.rows.find((r) => r.fields.title === '自带题名')
    expect(manual?.fieldSources.title).toBe('manual')
    expect(manual?.fields.subjects).toEqual(['主题1', '主题2'])

    const bad = batch.rows.find((r) => r.status === 'invalid')
    expect(bad?.error).toMatch(/title/)
  })

  it('commits only ready rows and writes titles + copies', async () => {
    const { imports, catalog } = build()
    const batch = await imports.preview(CSV)
    const committed = imports.commit(batch.id)

    expect(committed.status).toBe('committed')
    expect(committed.result).toEqual({ titlesCreated: 2, copiesCreated: 3 })
    expect(catalog.listTitles().map((t) => t.title).sort()).toEqual(['夏洛的网', '自带题名'])
    expect(catalog.findCopyByBarcode('A-2')?.shelfLocation).toBe('A区1排')
    expect(catalog.findCopyByBarcode('C-1')).toBeUndefined() // invalid 行不入库
  })

  it('lets the librarian correct a row before committing', async () => {
    const { imports, catalog } = build()
    const batch = await imports.preview(CSV)
    const badIndex = batch.rows.findIndex((r) => r.status === 'invalid')

    const corrected = imports.correctRow(batch.id, badIndex, { title: '手工补题名' })
    expect(corrected.rows[badIndex].status).toBe('ready')
    expect(corrected.rows[badIndex].fieldSources.title).toBe('manual')
    expect(corrected.summary).toEqual({ total: 3, ready: 3, invalid: 0 })

    const committed = imports.commit(batch.id)
    expect(committed.result?.titlesCreated).toBe(3)
    expect(catalog.findCopyByBarcode('C-1')).toBeTruthy()
  })

  it('marks duplicate barcodes invalid instead of half-importing them', async () => {
    const { imports, catalog } = build()
    catalog.addCopy(catalog.createTitle({ title: '已存在' }).id, { barcode: 'A-1' })

    const batch = await imports.preview(CSV)
    const charlotte = batch.rows.find((r) => r.lines.includes(2))
    expect(charlotte?.status).toBe('invalid')
    expect(charlotte?.error).toMatch(/A-1/)

    const committed = imports.commit(batch.id)
    expect(committed.result?.copiesCreated).toBe(1) // 仅「自带题名」的 B-1
  })

  it('is idempotent on commit and rejects committing twice with different results', async () => {
    const { imports } = build()
    const batch = await imports.preview(CSV)
    const first = imports.commit(batch.id)
    const second = imports.commit(batch.id)
    expect(second.result).toEqual(first.result)
  })

  it('rejects an empty sheet and unknown batch ids', async () => {
    const { imports } = build()
    await expect(imports.preview('   ')).rejects.toBeInstanceOf(ValidationError)
    await expect(imports.preview('isbn,title\n')).rejects.toBeInstanceOf(ValidationError)
    expect(() => imports.commit('nope')).toThrow(NotFoundError)
  })
})