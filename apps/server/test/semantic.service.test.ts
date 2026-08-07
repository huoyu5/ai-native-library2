import { describe, it, expect } from 'vitest'
import { CatalogService } from '../src/catalog/service.js'
import { ReaderService } from '../src/readers/service.js'
import { CirculationService } from '../src/circulation/service.js'
import { SearchService } from '../src/search/service.js'
import { SemanticSearchService, ValidationError } from '../src/search/semantic.js'

/**
 * Ticket 12 — 自然语言检索（Seam 1）。
 * 不变量：AI 只做「查询→关键词/意图」解析；相关度与引用依据由目录真实命中推导（不由 AI 编造）；
 * AI 失败/超时/输出不可解析 → 自动降级为关键词检索，结果照常返回（体验不中断）。
 */
function build(interpret: (q: string) => Promise<{ keywords: string[]; note?: string }>) {
  const catalog = new CatalogService()
  const readers = new ReaderService()
  const circulation = new CirculationService(readers, catalog)
  const search = new SearchService(catalog, circulation)
  const semantic = new SemanticSearchService({ search, interpret })

  const charlotte = catalog.createTitle({
    title: '夏洛的网',
    author: 'E.B.怀特',
    category: '儿童文学',
    subjects: ['友谊', '成长'],
  })
  catalog.addCopy(charlotte.id, { barcode: 'NL-1', shelfLocation: 'A区1排' })

  const santi = catalog.createTitle({
    title: '三体',
    author: '刘慈欣',
    category: '科幻',
    subjects: ['宇宙'],
  })
  catalog.addCopy(santi.id, { barcode: 'NL-2', shelfLocation: 'B区2排' })

  return { semantic, catalog }
}

describe('natural language search (Ticket 12, service seam)', () => {
  it('ranks results by relevance and cites the matched title and reason', async () => {
    const { semantic } = build(async () => ({
      keywords: ['友谊', '儿童文学'],
      note: '读者想找讲友谊的儿童读物',
    }))

    const res = await semantic.searchNatural('有没有讲友谊的儿童故事书？')
    expect(res.mode).toBe('semantic')
    expect(res.degraded).toBe(false)
    expect(res.interpretation).toContain('友谊')
    expect(res.results).toHaveLength(1)

    const top = res.results[0]!
    expect(top.title).toBe('夏洛的网')
    // 引用依据：命中题名 + 匹配理由（关键词命中了哪个字段）
    expect(top.reasons.map((r) => `${r.keyword}/${r.field}`).sort()).toEqual([
      '儿童文学/category',
      '友谊/subjects',
    ])
    // 架位指引沿用公共检索
    expect(top.availableShelf).toBe('A区1排')
    expect(top.copies[0]!.status).toBe('available')
  })

  it('scores multi-keyword hits above single-keyword hits', async () => {
    const { semantic } = build(async () => ({ keywords: ['刘慈欣', '三体', '友谊'] }))
    const res = await semantic.searchNatural('刘慈欣的三体')
    expect(res.results.map((r) => r.title)).toEqual(['三体', '夏洛的网'])
    expect(res.results[0]!.score).toBeGreaterThan(res.results[1]!.score)
  })

  it('degrades to keyword search when the AI interpreter fails', async () => {
    const { semantic } = build(async () => {
      throw new Error('ai provider exploded')
    })

    const res = await semantic.searchNatural('三体')
    expect(res.mode).toBe('keyword')
    expect(res.degraded).toBe(true)
    expect(res.keywords).toEqual(['三体'])
    // 体验不中断：仍然返回结果与架位
    expect(res.results.map((r) => r.title)).toEqual(['三体'])
    expect(res.results[0]!.availableShelf).toBe('B区2排')
    expect(res.results[0]!.reasons[0]).toEqual({ keyword: '三体', field: 'title' })
  })

  it('degrades when the AI returns no usable keywords', async () => {
    const { semantic } = build(async () => ({ keywords: [] }))
    const res = await semantic.searchNatural('夏洛')
    expect(res.degraded).toBe(true)
    expect(res.results.map((r) => r.title)).toEqual(['夏洛的网'])
  })

  it('returns an empty result set (not an error) when nothing matches', async () => {
    const { semantic } = build(async () => ({ keywords: ['量子金融'] }))
    const res = await semantic.searchNatural('有没有量子金融的书')
    expect(res.results).toEqual([])
  })

  it('rejects an empty query', async () => {
    const { semantic } = build(async () => ({ keywords: [] }))
    await expect(semantic.searchNatural('   ')).rejects.toBeInstanceOf(ValidationError)
  })
})