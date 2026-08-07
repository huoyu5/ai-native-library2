import { randomUUID } from 'node:crypto'
import type { CatalogService } from '../catalog/service.js'

/**
 * Ticket 11 — 自动编目 + 审核门 (Seam 1)。
 * 领域流：馆员扫码 ISBN → 外部书目库(mock)取元数据 → AI(降级)补全缺失字段 → 生成「建议」
 * （字段标注来源：external/ai/manual）→ 馆员审核：
 *   - 确认：写入目录（建题名）并记 `appliedBookId`；
 *   - 拒绝：不入库并记原因；
 * —— 建议未经确认永远不会进入目录（编目审核门）。
 * 幂等：同一 ISBN 重复扫描返回同一条建议。
 */

export type CatalogField = 'title' | 'author' | 'isbn' | 'category' | 'subjects' | 'publisher'

/** 参与编目的字段全集（富化管线按此顺序遍历）。 */
export const CATALOG_FIELDS = [
  'title',
  'author',
  'isbn',
  'category',
  'subjects',
  'publisher',
] as const satisfies readonly CatalogField[]
export type FieldSource = 'external' | 'ai' | 'manual'
export type SuggestionStatus = 'pending' | 'approved' | 'rejected'

/** 目录元数据负载（外部书目返回字段）。 */
export interface CatalogMetadata {
  title?: string
  author?: string
  isbn?: string
  category?: string
  subjects?: string[]
  publisher?: string
}

/** 建议中可写入目录的字段（与 CatalogService.CreateTitleInput 对齐）。 */
export interface SuggestionFields {
  title?: string
  author?: string
  isbn?: string
  category?: string
  subjects?: string[]
  publisher?: string
}

export interface CatalogingSuggestion {
  id: string
  isbn: string
  fields: SuggestionFields
  fieldSources: Partial<Record<CatalogField, FieldSource>>
  status: SuggestionStatus
  appliedBookId?: string
  rejectedReason?: string
  createdAt: string
}

/** 外部书目数据库（ISBN → 元数据）。真实集成需替换为外部库客户端；测试用 mock。 */
export interface CatalogBibProvider {
  lookup(isbn: string): Promise<CatalogMetadata | undefined>
}

export interface CatalogingServiceDeps {
  bib: CatalogBibProvider
  /** AI 补全：给定 ISBN 与目前已知字段，返回可补全的字段（缺失时由服务采用）。 */
  aiFill: (isbn: string, current: SuggestionFields) => Promise<SuggestionFields>
  catalog: CatalogService
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class CatalogingService {
  private suggestions = new Map<string, CatalogingSuggestion>()
  private byIsbn = new Map<string, string>() // isbn -> suggestion id（幂等）

  constructor(private readonly deps: CatalogingServiceDeps) {}

  /**
   * 编目富化管线（自动编目与批量导入共用，Ticket 11/13）：
   * 已知字段(seed，来源 manual) → 外部书目补缺(external) → AI 补缺(ai)。
   * 只做字段推导，不产生建议、不写目录。
   */
  async enrich(
    isbn: string,
    seed: SuggestionFields = {},
  ): Promise<{ fields: SuggestionFields; fieldSources: Partial<Record<CatalogField, FieldSource>> }> {
    let fields: SuggestionFields = {}
    const source: Partial<Record<CatalogField, FieldSource>> = {}

    // 1) 操作者/清单已给出的字段优先（来源 manual）
    for (const key of CATALOG_FIELDS) {
      if (!isTruthy(seed[key])) continue
      fields = { ...fields, [key]: seed[key] as never }
      source[key] = 'manual'
    }

    // 2) 外部书目库补缺（来源 external）
    const normalized = isbn.trim()
    const external = normalized ? ((await this.deps.bib.lookup(normalized)) ?? {}) : {}
    for (const key of CATALOG_FIELDS) {
      if (source[key] || !isTruthy(external[key])) continue
      fields = { ...fields, [key]: external[key] as never }
      source[key] = 'external'
    }

    // 3) AI 补缺（来源 ai）；AI 不可用时自然降级为「少几个字段」
    if (normalized) {
      const ai = await this.deps.aiFill(normalized, fields)
      for (const key of CATALOG_FIELDS) {
        if (source[key] || !isTruthy(ai[key])) continue
        fields = { ...fields, [key]: ai[key] as never }
        source[key] = 'ai'
      }
    }

    return { fields, fieldSources: source }
  }

  /** 扫码 ISBN → 生成待审建议；重复扫描幂等返回同一建议。 */
  async submit(isbn: string): Promise<CatalogingSuggestion> {
    const normalized = isbn.trim()
    if (!normalized) throw new ValidationError('isbn is required')

    const existingId = this.byIsbn.get(normalized)
    if (existingId) return this.suggestions.get(existingId)!

    const { fields, fieldSources: source } = await this.enrich(normalized)

    // 建议必须能给出题名，否则无法入库
    if (!fields.title || !fields.title.trim()) {
      throw new ValidationError('unable to derive a catalog title')
    }

    const suggestion: CatalogingSuggestion = {
      id: randomUUID(),
      isbn: normalized,
      fields,
      fieldSources: source,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    this.suggestions.set(suggestion.id, suggestion)
    this.byIsbn.set(normalized, suggestion.id)
    return suggestion
  }

  /** 馆员确认入库：写在审门通过，写入目录并记录 appliedBookId。已审核幂等。 */
  approve(id: string): CatalogingSuggestion {
    const s = this.suggestions.get(id)
    if (!s) throw new NotFoundError('cataloging suggestion not found')
    if (s.status === 'approved') return s
    if (s.status === 'rejected') throw new ValidationError('rejected suggestion cannot be approved')

    const book = this.deps.catalog.createTitle({
      title: s.fields.title ?? '',
      author: s.fields.author,
      isbn: s.fields.isbn,
      category: s.fields.category,
      subjects: s.fields.subjects,
      publisher: s.fields.publisher,
    })
    s.appliedBookId = book.id
    s.status = 'approved'
    return s
  }

  /** 馆员拒绝 → 不进入目录，记录原因。 */
  reject(id: string, reason?: string): CatalogingSuggestion {
    const s = this.suggestions.get(id)
    if (!s) throw new NotFoundError('cataloging suggestion not found')
    if (s.status === 'approved') throw new ValidationError('approved suggestion cannot be rejected')
    s.status = 'rejected'
    if (reason) s.rejectedReason = reason.trim()
    return s
  }

  get(id: string): CatalogingSuggestion {
    const s = this.suggestions.get(id)
    if (!s) throw new NotFoundError('cataloging suggestion not found')
    return s
  }

  list(): CatalogingSuggestion[] {
    return [...this.suggestions.values()]
  }

  /** 备份快照（Ticket 14）。 */
  snapshot(): CatalogingSuggestion[] {
    return [...this.suggestions.values()]
  }

  /** 恢复（Ticket 14）：清空后按快照重建（含 ISBN 幂等索引）。 */
  restore(suggestions: CatalogingSuggestion[]): void {
    this.suggestions.clear()
    this.byIsbn.clear()
    for (const s of suggestions) {
      this.suggestions.set(s.id, s)
      this.byIsbn.set(s.isbn, s.id)
    }
  }
}

function isTruthy(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  return Array.isArray(value) ? value.length > 0 : Boolean(value)
}