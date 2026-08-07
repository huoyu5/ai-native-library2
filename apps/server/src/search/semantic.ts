import type { SearchService, TitleSearchResult } from './service.js'

/**
 * Ticket 12 — 自然语言检索（Seam 1，含降级）。
 *
 * 职责切分（spec「引用」边界）：
 *  - AI 只做「自然语言 → 关键词 + 意图说明」的解析；
 *  - 相关度与引用依据完全由目录中的真实字段命中推导，AI 不参与排序、不编造引用；
 *  - AI 不可用/超时/输出不可用 → 自动降级为关键词检索（原查询直接当关键词），
 *    结果照常返回并在响应里显式标记 `degraded`，前端体验不中断。
 */

/** 关键词命中的字段（引用依据的「匹配理由」）。 */
export type MatchField = 'title' | 'author' | 'isbn' | 'category' | 'subjects' | 'publisher'

export interface MatchReason {
  keyword: string
  field: MatchField
}

export interface SemanticResult extends TitleSearchResult {
  /** 相关度得分：字段权重 × 命中关键词数 */
  score: number
  /** 引用依据：命中了哪个关键词、命中在哪个字段 */
  reasons: MatchReason[]
}

export interface SemanticSearchResponse {
  query: string
  mode: 'semantic' | 'keyword'
  /** true = 走了降级路径（AI 不可用/无可用关键词） */
  degraded: boolean
  /** AI 对查询的理解说明（降级时为原查询） */
  interpretation: string
  keywords: string[]
  results: SemanticResult[]
}

/** AI 查询解析器：自然语言 → 关键词 + 意图说明。 */
export type QueryInterpreter = (query: string) => Promise<{ keywords: string[]; note?: string }>

export interface SemanticSearchDeps {
  search: SearchService
  interpret: QueryInterpreter
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/** 字段权重：题名最高，作者/ISBN 次之，其余为辅。 */
const FIELD_WEIGHT: Record<MatchField, number> = {
  title: 3,
  author: 2,
  isbn: 2,
  category: 1,
  subjects: 1,
  publisher: 1,
}

export class SemanticSearchService {
  constructor(private readonly deps: SemanticSearchDeps) {}

  async searchNatural(query: string, now: Date = new Date()): Promise<SemanticSearchResponse> {
    const q = query.trim()
    if (!q) throw new ValidationError('query is required')

    let keywords: string[] = []
    let note = ''
    let degraded = false

    try {
      const parsed = await this.deps.interpret(q)
      keywords = (parsed.keywords ?? []).map((k) => k.trim()).filter(Boolean)
      note = parsed.note?.trim() ?? ''
    } catch {
      degraded = true // AI 供应商错/超时 → 降级
    }

    if (keywords.length === 0) {
      degraded = true
      keywords = degradedKeywords(q) // 降级：本地分词后当关键词检索
    }

    let results = this.collect(keywords, now)

    // AI 关键词一无所获（含供应商回声/幻觉等不可用输出）时，同样降级到本地分词检索：
    // 「体验不中断」要求读者至少拿到关键词检索的结果，而不是空手而归。
    if (results.length === 0 && !degraded) {
      degraded = true
      keywords = degradedKeywords(q)
      results = this.collect(keywords, now)
    }

    return {
      query: q,
      mode: degraded ? 'keyword' : 'semantic',
      degraded,
      interpretation: degraded ? q : note || keywords.join('、'),
      keywords,
      results,
    }
  }

  /**
   * 目录命中收集：每个关键词各跑一次关键词检索，按命中字段累计相关度并记录引用依据。
   * 相关度与引用全部来自目录真实字段命中，AI 不参与。
   */
  private collect(keywords: string[], now: Date): SemanticResult[] {
    const byId = new Map<string, SemanticResult>()
    for (const keyword of keywords) {
      for (const hit of this.deps.search.search(keyword, now)) {
        const fields = matchedFields(hit, keyword)
        if (fields.length === 0) continue

        const target = byId.get(hit.id) ?? { ...hit, score: 0, reasons: [] }
        for (const field of fields) {
          target.score += FIELD_WEIGHT[field]
          target.reasons.push({ keyword, field })
        }
        byId.set(hit.id, target)
      }
    }

    return [...byId.values()].sort((a, b) =>
      b.score !== a.score ? b.score - a.score : a.title.localeCompare(b.title),
    )
  }
}

/** 中文疑问/口语虚词：降级分词时先丢掉，避免「有没有」「我想看」这类词干扰命中。 */
const STOP_WORDS = [
  '有没有',
  '我想看',
  '我想找',
  '推荐',
  '关于',
  '适合',
  '想看',
  '想找',
  '一本',
  '一些',
  '的书',
  '书籍',
  '读物',
  '有关',
  '请问',
  '的',
  '吗',
  '呢',
  '啊',
  '了',
  '和',
  '与',
]

/**
 * 降级分词（无 AI 时使用）：按标点/空白切分，去虚词，并对中文补 2 字 n-gram，
 * 使「讲友谊的儿童故事」这类整句也能命中「友谊」等字段值。
 */
function degradedKeywords(query: string): string[] {
  let text = query
  for (const stop of STOP_WORDS) text = text.split(stop).join(' ')

  const segments = text
    .split(/[\s,，。、？?!！;；:：'"'"()（）【】[\]]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const keywords = new Set<string>([query.trim()])
  for (const segment of segments) {
    keywords.add(segment)
    // 中文无空格，补 2 字 n-gram 作为候选关键词
    if (/[\u4e00-\u9fa5]/.test(segment)) {
      for (let i = 0; i + 2 <= segment.length; i += 1) {
        keywords.add(segment.slice(i, i + 2))
      }
    }
  }
  return [...keywords].filter((k) => k.length >= 2)
}

/** 关键词在该题名的哪些字段命中（不区分大小写子串），即引用依据。 */
function matchedFields(hit: TitleSearchResult, keyword: string): MatchField[] {
  const needle = keyword.toLowerCase()
  const hitsText = (value: string | undefined): boolean =>
    !!value && value.toLowerCase().includes(needle)

  const fields: MatchField[] = []
  if (hitsText(hit.title)) fields.push('title')
  if (hitsText(hit.author)) fields.push('author')
  if (hitsText(hit.isbn)) fields.push('isbn')
  if (hitsText(hit.category)) fields.push('category')
  if (hit.subjects.some((s) => s.toLowerCase().includes(needle))) fields.push('subjects')
  if (hitsText(hit.publisher)) fields.push('publisher')
  return fields
}