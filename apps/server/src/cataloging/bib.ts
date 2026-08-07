import type { CatalogBibProvider, CatalogMetadata } from './service.js'

/**
 * 外部书目库 mock（Ticket 11）：ISBN → 元数据的内存查表。
 * 真实集成应替换为外部书目数据库客户端（如 OpenLibrary/国家图书馆 API）；
 * 此实现满足「外部书目库集成在 API seam 验证（mock 外部依赖）」，并保证无外部网络也可用。
 */
export class MemoryCatalogBibProvider implements CatalogBibProvider {
  private table = new Map<string, CatalogMetadata>()

  constructor(entries?: Array<{ isbn: string; metadata: CatalogMetadata }>) {
    for (const { isbn, metadata } of entries ?? []) {
      this.table.set(isbn, metadata)
    }
  }

  async lookup(isbn: string): Promise<CatalogMetadata | undefined> {
    return this.table.get(isbn)
  }
}