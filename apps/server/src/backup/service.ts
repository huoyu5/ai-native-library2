import type { ReaderService, Reader } from '../readers/service.js'
import type { CatalogService, Title, Copy } from '../catalog/service.js'
import type { CirculationService, Loan } from '../circulation/service.js'
import type { CatalogingService, CatalogingSuggestion } from '../cataloging/service.js'
import type { ImportService, ImportBatch } from '../import/service.js'

/**
 * Ticket 14 — 数据备份与恢复。
 * 全量快照各领域内存状态为 JSON，馆员可定期导出备份；
 * 恢复操作清空现有数据并加载快照（校内服务器数据迁移或灾备恢复）。
 */

export interface BackupSnapshot {
  version: string
  timestamp: string
  readers: Reader[]
  catalog: { titles: Title[]; copies: Copy[] }
  circulation: { loans: Loan[] }
  cataloging: CatalogingSuggestion[]
  imports: ImportBatch[]
}

export interface BackupServiceDeps {
  readers: ReaderService
  catalog: CatalogService
  circulation: CirculationService
  cataloging: CatalogingService
  imports: ImportService
}

export class BackupService {
  constructor(private readonly deps: BackupServiceDeps) {}

  snapshot(): BackupSnapshot {
    return {
      version: '1.0',
      timestamp: new Date().toISOString(),
      readers: this.deps.readers.snapshot(),
      catalog: this.deps.catalog.snapshot(),
      circulation: this.deps.circulation.snapshot(),
      cataloging: this.deps.cataloging.snapshot(),
      imports: this.deps.imports.snapshot(),
    }
  }

  restore(snap: BackupSnapshot): void {
    this.deps.readers.restore(snap.readers)
    this.deps.catalog.restore(snap.catalog)
    this.deps.circulation.restore(snap.circulation)
    this.deps.cataloging.restore(snap.cataloging)
    this.deps.imports.restore(snap.imports)
  }
}