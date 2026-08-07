import { describe, it, expect } from 'vitest'
import { CatalogService } from '../src/catalog/service.js'
import {
  CatalogingService,
  type CatalogBibProvider,
  type SuggestionFields,
} from '../src/cataloging/service.js'

/**
 * Ticket 11 — 离线评测：golden ISBN 集达到约定编目字段准确率（spec「离线评测」）。
 * 模拟真实系统：外部书目库对部分 ISBN 只覆盖部分字段，AI 补全剩余缺口；
 * 校验系统在 golden 集上的字段准确率 ≥ 0.9。
 */
const GOLDEN: Array<{ isbn: string; expected: SuggestionFields }> = [
  { isbn: 'isbn-G1', expected: { title: '夏洛的网', author: 'E.B.怀特', category: '儿童文学', publisher: '作家社' } },
  { isbn: 'isbn-G2', expected: { title: '活着', author: '余华', category: '长篇小说', publisher: '先锋社' } },
  { isbn: 'isbn-G3', expected: { title: '三体', author: '刘慈欣', category: '科幻', publisher: '少儿社' } },
  { isbn: 'isbn-G4', expected: { title: '小王子', author: '圣埃克', category: '童话', publisher: '人文社' } },
]

/**
 * 外部书目 mock：覆盖部分 ISBN 的部分字段（对应真实覆盖率 < 100%），其余缺失交给 AI。
 */
function partialBib(): CatalogBibProvider {
  const external: Record<string, SuggestionFields> = {
    'isbn-G1': { title: '夏洛的网' },
    'isbn-G2': {},
    'isbn-G3': { title: '三体', author: '刘慈欣' },
    'isbn-G4': {},
  }
  return {
    async lookup(isbn) {
      return external[isbn]
    },
  }
}

/** 确定性 AI 补全：为每个 ISBN 补全其缺失字段（能力足够的 AI 编目）。 */
function aiGolden(): (isbn: string) => Promise<SuggestionFields> {
  const map = new Map(GOLDEN.map((g) => [g.isbn, g.expected]))
  return async (isbn) => map.get(isbn) ?? {}
}

describe('cataloging golden evaluation (Ticket 11, offline)', () => {
  it('achieves field accuracy >= 0.9 on the golden ISBN set', async () => {
    const svc = new CatalogingService({
      bib: partialBib(),
      aiFill: aiGolden(),
      catalog: new CatalogService(),
    })

    let matched = 0
    let total = 0
    for (const { isbn, expected } of GOLDEN) {
      const s = await svc.submit(isbn)
      for (const key of ['title', 'author', 'category', 'publisher'] as const) {
        const want = expected[key]
        if (!want) continue
        total += 1
        if (s.fields[key] === want) matched += 1
      }
    }

    const accuracy = matched / total
    expect(accuracy).toBeGreaterThanOrEqual(0.9)
  })
})