import { randomUUID } from 'node:crypto'

/**
 * Ticket 03 — 题名与副本管理 (Seam 1: 应用服务公共接口)。
 * 题名/副本分层：题名承载书目元数据，副本为实体实例（条码标识、架位号），一题多副本。
 * 元数据采用简化字段（ADR-0001，不引入 MARC）。
 */

export interface Title {
  id: string
  title: string
  author?: string
  isbn?: string
  category?: string
  subjects: string[]
  publisher?: string
  createdAt: string
}

export interface Copy {
  id: string
  titleId: string
  /** 条码：副本唯一标识 */
  barcode: string
  /** 架位号：馆内物理位置（如「A区3排」） */
  shelfLocation?: string
  createdAt: string
}

export interface TitleDetail extends Title {
  copies: Copy[]
}

export interface CreateTitleInput {
  title: string
  author?: string
  isbn?: string
  category?: string
  subjects?: string[]
  publisher?: string
}

export interface UpdateTitleInput {
  title?: string
  author?: string
  isbn?: string
  category?: string
  subjects?: string[]
  publisher?: string
}

export interface AddCopyInput {
  barcode: string
  shelfLocation?: string
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

export class CatalogService {
  private titles = new Map<string, Title>()
  private copies = new Map<string, Copy>()
  private barcodes = new Map<string, Copy>()

  createTitle(input: CreateTitleInput): Title {
    const name = input.title.trim()
    if (!name) throw new ValidationError('title is required')

    const title: Title = {
      id: randomUUID(),
      title: name,
      subjects: input.subjects ?? [],
      createdAt: new Date().toISOString(),
    }
    if (input.author) title.author = input.author
    if (input.isbn) title.isbn = input.isbn
    if (input.category) title.category = input.category
    if (input.publisher) title.publisher = input.publisher

    this.titles.set(title.id, title)
    return title
  }

  addCopy(titleId: string, input: AddCopyInput): Copy {
    if (!this.titles.has(titleId)) throw new NotFoundError('title not found')

    const barcode = input.barcode.trim()
    if (!barcode) throw new ValidationError('barcode is required')
    if (this.barcodes.has(barcode)) throw new ValidationError(`duplicate barcode: ${barcode}`)

    const copy: Copy = {
      id: randomUUID(),
      titleId,
      barcode,
      createdAt: new Date().toISOString(),
    }
    if (input.shelfLocation) copy.shelfLocation = input.shelfLocation

    this.copies.set(copy.id, copy)
    this.barcodes.set(barcode, copy)
    return copy
  }

  updateTitle(id: string, patch: UpdateTitleInput): Title {
    const title = this.titles.get(id)
    if (!title) throw new NotFoundError('title not found')

    if (patch.title !== undefined) {
      const name = patch.title.trim()
      if (!name) throw new ValidationError('title is required')
      title.title = name
    }
    if (patch.author !== undefined) title.author = patch.author
    if (patch.isbn !== undefined) title.isbn = patch.isbn
    if (patch.category !== undefined) title.category = patch.category
    if (patch.subjects !== undefined) title.subjects = patch.subjects
    if (patch.publisher !== undefined) title.publisher = patch.publisher

    return title
  }

  /** 题名详情：含该题名全部副本（一题多副本可见）。 */
  getTitleDetail(id: string): TitleDetail | undefined {
    const title = this.titles.get(id)
    if (!title) return undefined
    return { ...title, copies: this.copiesOf(id) }
  }

  copiesOf(titleId: string): Copy[] {
    return [...this.copies.values()].filter((c) => c.titleId === titleId)
  }

  findCopyByBarcode(barcode: string): Copy | undefined {
    return this.barcodes.get(barcode)
  }

  listTitles(): Title[] {
    return [...this.titles.values()]
  }

  /**
   * 关键词检索题名元数据（Ticket 09 公共检索）。按字段命中度排序：题名权重最高。
   * 命中字段：题名、作者、ISBN、分类、主题、出版方（不区分大小写，子串匹配）。
   */
  findTitlesByQuery(query: string): Title[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return [...this.titles.values()]
      .map((title) => ({ title, score: this.matchScore(title, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return a.title.createdAt < b.title.createdAt ? -1 : 1
      })
      .map((x) => x.title)
  }

  private matchScore(title: Title, q: string): number {
    const score = (v: string | undefined, weight: number): number =>
      v && v.toLowerCase().includes(q) ? weight : 0
    const best = Math.max(
      score(title.title, 3),
      score(title.author, 2),
      score(title.isbn, 2),
      score(title.category, 1),
      score(title.publisher, 1),
      title.subjects.some((s) => s.toLowerCase().includes(q)) ? 1 : 0,
    )
    return best
  }
}