import type { CatalogService } from '../catalog/service.js'
import type { CirculationService } from '../circulation/service.js'

/**
 * 公共检索（Ticket 09，Seam 1）。
 * 免登录关键词检索：命中考题名元数据，结果附书籍详情、每副本可借状态与架位号指引。
 * 该接口无鉴权（访客可用），是 AI 自然语言检索（Ticket 14）的降级路径。
 */
export type CopyStatus = 'available' | 'borrowed' | 'overdue'

export interface CopyAvailability {
  barcode: string
  shelfLocation?: string
  status: CopyStatus
}

export interface TitleSearchResult {
  id: string
  title: string
  author?: string
  isbn?: string
  category?: string
  subjects: string[]
  publisher?: string
  /** 架位号指引：首个可借副本的位置，其次为首副本位置 */
  availableShelf?: string
  copies: CopyAvailability[]
}

export class SearchService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly circulation: CirculationService,
  ) {}

  search(query: string, now: Date = new Date()): TitleSearchResult[] {
    return this.catalog.findTitlesByQuery(query).map((title) => this.toResult(title, now))
  }

  private toResult(title: { id: string; title: string; author?: string; isbn?: string; category?: string; subjects: string[]; publisher?: string }, now: Date): TitleSearchResult {
    const copies: CopyAvailability[] = this.catalog
      .copiesOf(title.id)
      .map((c) => ({
        barcode: c.barcode,
        ...(c.shelfLocation ? { shelfLocation: c.shelfLocation } : {}),
        status: this.circulation.copyStatus(c.barcode, now),
      }))
    const firstAvailable = copies.find((c) => c.status === 'available')
    const shelfSource = firstAvailable ?? copies[0]

    return {
      id: title.id,
      title: title.title,
      subjects: title.subjects,
      ...(title.author ? { author: title.author } : {}),
      ...(title.isbn ? { isbn: title.isbn } : {}),
      ...(title.category ? { category: title.category } : {}),
      ...(title.publisher ? { publisher: title.publisher } : {}),
      ...(shelfSource?.shelfLocation ? { availableShelf: shelfSource.shelfLocation } : {}),
      copies,
    }
  }
}