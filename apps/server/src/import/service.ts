import { randomUUID } from 'node:crypto'
import type { CatalogService } from '../catalog/service.js'
import {
  CATALOG_FIELDS,
  type CatalogField,
  type CatalogingService,
  type FieldSource,
  type SuggestionFields,
} from '../cataloging/service.js'

/**
 * Ticket 13 — 初始建库（批量导入，Seam 1）。
 * 馆员上传馆藏清单（CSV；Excel 请先导出为 CSV）→ 复用编目富化管线（清单字段 manual >
 * 外部书目 external > AI ai）生成「题名 + 副本」建议 → 预览可修正 → 确认后才写入目录。
 * 预览阶段绝不触碰目录（与自动编目同一条审核门约束）。
 */

export interface ImportCopyDraft {
  barcode: string
  shelfLocation?: string
}

export interface ImportRow {
  /** 该题名来自清单的哪些行（1 基，含表头行号，便于馆员定位修正） */
  lines: number[]
  isbn?: string
  fields: SuggestionFields
  fieldSources: Partial<Record<CatalogField, FieldSource>>
  copies: ImportCopyDraft[]
  status: 'ready' | 'invalid'
  error?: string
}

export interface ImportBatch {
  id: string
  createdAt: string
  status: 'preview' | 'committed' | 'discarded'
  rows: ImportRow[]
  summary: { total: number; ready: number; invalid: number }
  result?: { titlesCreated: number; copiesCreated: number }
}

export interface ImportServiceDeps {
  cataloging: CatalogingService
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

export class ImportService {
  private batches = new Map<string, ImportBatch>()

  constructor(private readonly deps: ImportServiceDeps) {}

  /** 解析清单 → 富化 → 生成预览批次（不写目录）。 */
  async preview(csv: string): Promise<ImportBatch> {
    const table = parseCsv(csv)
    const header = table[0]
    if (!header) throw new ValidationError('the sheet is empty')
    const dataRows = table.slice(1)
    if (dataRows.length === 0) throw new ValidationError('the sheet has no data rows')

    const columns = header.map((h) => h.trim().toLowerCase())
    const drafts = new Map<string, ImportRow>()

    for (const [offset, cells] of dataRows.entries()) {
      const line = offset + 2 // 1 基 + 表头
      const get = (name: string): string => {
        const idx = columns.indexOf(name)
        return idx >= 0 ? (cells[idx] ?? '').trim() : ''
      }

      const isbn = get('isbn')
      const seed: SuggestionFields = {}
      const title = get('title')
      if (title) seed.title = title
      const author = get('author')
      if (author) seed.author = author
      const category = get('category')
      if (category) seed.category = category
      const publisher = get('publisher')
      if (publisher) seed.publisher = publisher
      const subjects = get('subjects')
      if (subjects) seed.subjects = subjects.split(/[|、;]/).map((s) => s.trim()).filter(Boolean)
      if (isbn) seed.isbn = isbn

      const barcode = get('barcode')
      const shelfLocation = get('shelflocation')

      // 同一题名（按 ISBN，否则按题名）在清单里多行 = 一题多副本
      const key = isbn ? `isbn:${isbn}` : `title:${title || `line-${line}`}`
      const existing = drafts.get(key)
      if (existing) {
        existing.lines.push(line)
        if (barcode) existing.copies.push(copyDraft(barcode, shelfLocation))
        continue
      }

      const { fields, fieldSources } = await this.deps.cataloging.enrich(isbn, seed)
      const row: ImportRow = {
        lines: [line],
        fields,
        fieldSources,
        copies: barcode ? [copyDraft(barcode, shelfLocation)] : [],
        status: 'ready',
      }
      if (isbn) row.isbn = isbn
      drafts.set(key, row)
    }

    const batch: ImportBatch = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'preview',
      rows: [...drafts.values()],
      summary: { total: 0, ready: 0, invalid: 0 },
    }
    this.classify(batch)
    this.batches.set(batch.id, batch)
    return batch
  }

  /** 馆员修正预览行（字段来源标 manual），随后重新校验该批次。 */
  correctRow(batchId: string, index: number, patch: SuggestionFields): ImportBatch {
    const batch = this.get(batchId)
    if (batch.status !== 'preview') {
      throw new ValidationError('only a preview batch can be corrected')
    }
    const row = batch.rows[index]
    if (!row) throw new NotFoundError(`import row not found: ${index}`)

    for (const key of CATALOG_FIELDS) {
      const value = patch[key]
      if (value === undefined) continue
      row.fields = { ...row.fields, [key]: value as never }
      row.fieldSources[key] = 'manual'
    }
    this.classify(batch)
    return batch
  }

  /** 确认入库：仅 ready 行写入目录（题名 + 副本）。已确认的批次幂等。 */
  commit(batchId: string): ImportBatch {
    const batch = this.get(batchId)
    if (batch.status === 'committed') return batch
    if (batch.status === 'discarded') throw new ValidationError('discarded batch cannot be committed')

    this.classify(batch) // 提交前重新校验（条码可能已被他处占用）

    let titlesCreated = 0
    let copiesCreated = 0
    for (const row of batch.rows) {
      if (row.status !== 'ready') continue
      const title = this.deps.catalog.createTitle({
        title: row.fields.title ?? '',
        author: row.fields.author,
        isbn: row.fields.isbn,
        category: row.fields.category,
        subjects: row.fields.subjects,
        publisher: row.fields.publisher,
      })
      titlesCreated += 1
      for (const copy of row.copies) {
        this.deps.catalog.addCopy(title.id, copy)
        copiesCreated += 1
      }
    }

    batch.status = 'committed'
    batch.result = { titlesCreated, copiesCreated }
    return batch
  }

  /** 放弃批次（不入库）。 */
  discard(batchId: string): ImportBatch {
    const batch = this.get(batchId)
    if (batch.status === 'committed') throw new ValidationError('committed batch cannot be discarded')
    batch.status = 'discarded'
    return batch
  }

  get(batchId: string): ImportBatch {
    const batch = this.batches.get(batchId)
    if (!batch) throw new NotFoundError('import batch not found')
    return batch
  }

  list(): ImportBatch[] {
    return [...this.batches.values()]
  }

  /** 行级校验：必须有题名；条码不得与目录或批内其它行冲突。 */
  private classify(batch: ImportBatch): void {
    const seen = new Map<string, number>() // barcode -> row index
    batch.rows.forEach((row, index) => {
      delete row.error
      row.status = 'ready'

      if (!row.fields.title || !row.fields.title.trim()) {
        row.status = 'invalid'
        row.error = 'missing title: neither the sheet, the bibliographic database nor AI provided one'
        return
      }

      for (const copy of row.copies) {
        if (this.deps.catalog.findCopyByBarcode(copy.barcode)) {
          row.status = 'invalid'
          row.error = `duplicate barcode already in the catalog: ${copy.barcode}`
          return
        }
        const owner = seen.get(copy.barcode)
        if (owner !== undefined && owner !== index) {
          row.status = 'invalid'
          row.error = `duplicate barcode inside the sheet: ${copy.barcode}`
          return
        }
        seen.set(copy.barcode, index)
      }
    })

    batch.summary = {
      total: batch.rows.length,
      ready: batch.rows.filter((r) => r.status === 'ready').length,
      invalid: batch.rows.filter((r) => r.status === 'invalid').length,
    }
  }
}

function copyDraft(barcode: string, shelfLocation: string): ImportCopyDraft {
  const draft: ImportCopyDraft = { barcode }
  if (shelfLocation) draft.shelfLocation = shelfLocation
  return draft
}

/** 最小 CSV 解析：支持引号包裹、引号内逗号与转义引号；忽略空行。 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/\r\n?/g, '\n').trim()
  if (!text) return []

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      cell = ''
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
    } else {
      cell += ch
    }
  }
  row.push(cell)
  if (row.some((c) => c.trim())) rows.push(row)
  return rows
}