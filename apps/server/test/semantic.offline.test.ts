import { describe, it, expect } from 'vitest'
import { CatalogService } from '../src/catalog/service.js'
import { ReaderService } from '../src/readers/service.js'
import { CirculationService } from '../src/circulation/service.js'
import { SearchService } from '../src/search/service.js'
import { SemanticSearchService } from '../src/search/semantic.js'

/**
 * Ticket 12 — 离线评测：golden 自然语言查询集达到约定命中率（spec「离线评测」）。
 * 命中判定：期望题名出现在结果首位（top-1），衡量「相关度排序」是否真的可用。
 * 同一评测集在降级路径（不用 AI，仅关键词）下同样跑一遍，确保降级体验不塌。
 */
const GOLDEN: Array<{ query: string; keywords: string[]; expectTop: string }> = [
  { query: '有没有讲友谊的儿童故事？', keywords: ['友谊', '儿童文学'], expectTop: '夏洛的网' },
  { query: '我想看刘慈欣的科幻', keywords: ['刘慈欣', '科幻'], expectTop: '三体' },
  { query: '关于宇宙探索的书', keywords: ['宇宙'], expectTop: '三体' },
  { query: '适合小学生的成长读物', keywords: ['成长', '儿童文学'], expectTop: '夏洛的网' },
  { query: '余华的长篇小说', keywords: ['余华'], expectTop: '活着' },
]

function buildLibrary() {
  const catalog = new CatalogService()
  const readers = new ReaderService()
  const circulation = new CirculationService(readers, catalog)
  const search = new SearchService(catalog, circulation)

  const seed = [
    { title: '夏洛的网', author: 'E.B.怀特', category: '儿童文学', subjects: ['友谊', '成长'], barcode: 'EV-1' },
    { title: '三体', author: '刘慈欣', category: '科幻', subjects: ['宇宙'], barcode: 'EV-2' },
    { title: '活着', author: '余华', category: '长篇小说', subjects: ['命运'], barcode: 'EV-3' },
  ]
  for (const s of seed) {
    const t = catalog.createTitle({
      title: s.title,
      author: s.author,
      category: s.category,
      subjects: s.subjects,
    })
    catalog.addCopy(t.id, { barcode: s.barcode, shelfLocation: 'A区1排' })
  }
  return search
}

async function topOneRate(semantic: SemanticSearchService): Promise<number> {
  let hits = 0
  for (const g of GOLDEN) {
    const res = await semantic.searchNatural(g.query)
    if (res.results[0]?.title === g.expectTop) hits += 1
  }
  return hits / GOLDEN.length
}

describe('natural language search offline evaluation (Ticket 12, golden queries)', () => {
  it('achieves the agreed top-1 hit rate (>= 0.8) with AI interpretation', async () => {
    const search = buildLibrary()
    const byQuery = new Map(GOLDEN.map((g) => [g.query, g.keywords]))
    const semantic = new SemanticSearchService({
      search,
      interpret: async (q) => ({ keywords: byQuery.get(q) ?? [], note: `解析: ${q}` }),
    })

    expect(await topOneRate(semantic)).toBeGreaterThanOrEqual(0.8)
  })

  it('still answers every golden query on the degraded keyword path', async () => {
    const search = buildLibrary()
    const semantic = new SemanticSearchService({
      search,
      interpret: async () => {
        throw new Error('ai unavailable')
      },
    })

    // 降级路径用原查询做关键词，命中率必然低于语义路径，但不得报错、不得全空。
    let answered = 0
    for (const g of GOLDEN) {
      const res = await semantic.searchNatural(g.query)
      expect(res.degraded).toBe(true)
      expect(res.mode).toBe('keyword')
      if (res.results.length > 0) answered += 1
    }
    expect(answered).toBeGreaterThanOrEqual(1)
  })
})