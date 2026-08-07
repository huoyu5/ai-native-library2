import { describe, it, expect } from 'vitest'
import { CatalogService } from '../src/catalog/service.js'
import {
  CatalogingService,
  ValidationError,
  NotFoundError,
  type CatalogBibProvider,
  type CatalogMetadata,
  type SuggestionFields,
} from '../src/cataloging/service.js'

/**
 * Ticket 11 — 自动编目 + 审核门 (Seam 1)。
 * 不变量：ISBN → 建议(字段标注来源)；未经确认不入库（审核门）；确认后入库、拒绝不入库；扫描幂等。
 */
function memBib(entries: Array<{ isbn: string; metadata: CatalogMetadata }>): CatalogBibProvider {
  return {
    async lookup(isbn) {
      return entries.find((e) => e.isbn === isbn)?.metadata
    },
  }
}

/** 确定性 AI 补齐（离线评测用）：返回给定 ISBN 的补全字段，仅当外部书目缺该字段时采用。 */
const AI_BY_ISBN: Record<string, SuggestionFields> = {
  '978-978978978': { title: 'AI书名', author: 'AI作者', category: 'AI分类' },
}

function buildSvc(entries: Array<{ isbn: string; metadata: CatalogMetadata }> = []) {
  const catalog = new CatalogService()
  const svc = new CatalogingService({
    bib: memBib(entries),
    aiFill: async (isbn) => AI_BY_ISBN[isbn] ?? {},
    catalog,
  })
  return { svc, catalog }
}

describe('cataloging suggestion (Ticket 11, service seam)', () => {
  it('builds a pending suggestion from external metadata, tagging source=external', async () => {
    const { svc } = buildSvc([
      {
        isbn: 'ISBN1',
        metadata: { title: '夏洛的网', author: 'E.B.怀特', category: '儿童文学', subjects: ['童话'] },
      },
    ])
    const s = await svc.submit('ISBN1')
    expect(s.status).toBe('pending')
    expect(s.fields.title).toBe('夏洛的网')
    expect(s.fields.author).toBe('E.B.怀特')
    expect(s.fieldSources.title).toBe('external')
    expect(s.fieldSources.author).toBe('external')
  })

  it('is not in the catalog while pending (audit gate)', async () => {
    const { svc, catalog } = buildSvc([{ isbn: 'ISBNX', metadata: { title: '未审核之书' } }])
    await svc.submit('ISBNX')
    const names = catalog.listTitles().map((t) => t.title)
    expect(names).not.toContain('未审核之书')
  })

  it('fills fields via AI when external database has no record (source=ai)', async () => {
    const { svc } = buildSvc([])
    const s = await svc.submit('978-978978978')
    expect(s.status).toBe('pending')
    expect(s.fieldSources.title).toBe('ai')
    expect(s.fields.title).toBe('AI书名')
    expect(s.fields.author).toBe('AI作者')
    expect(s.fields.category).toBe('AI分类')
  })

  it('approve commits to catalog and tags appliedBookId; second approve is idempotent', async () => {
    const { svc, catalog } = buildSvc([
      { isbn: 'ISBN2', metadata: { title: '活着', author: '余华', publisher: '作家社' } },
    ])
    const pending = await svc.submit('ISBN2')

    const approved = await svc.approve(pending.id)
    expect(approved.status).toBe('approved')
    expect(approved.appliedBookId).toBeTruthy()

    const detail = catalog.getTitleDetail(approved.appliedBookId)
    expect(detail?.title).toBe('活着')
    expect(detail?.author).toBe('余华')
    expect(detail?.publisher).toBe('作家社')

    const again = await svc.approve(pending.id)
    expect(again.appliedBookId).toBe(approved.appliedBookId)
  })

  it('reject stays out of the catalog and records the reason', async () => {
    const { svc, catalog } = buildSvc([{ isbn: 'ISBN3', metadata: { title: '该书信息有误' } }])
    const pending = await svc.submit('ISBN3')
    const rejected = await svc.reject(pending.id, '测试题名有误')
    expect(rejected.status).toBe('rejected')
    expect(rejected.rejectedReason).toBe('测试题名有误')
    expect(catalog.listTitles()).toHaveLength(0)
  })

  it('rejects submitting with an empty ISBN (422)', async () => {
    const { svc } = buildSvc([])
    await expect(svc.submit('   ')).rejects.toBeInstanceOf(ValidationError)
  })

  it('fails to build a suggestion when neither the bib nor AI can derive a title', async () => {
    const { svc } = buildSvc([])
    await expect(svc.submit('ISBN-NO-TITLE')).rejects.toBeInstanceOf(ValidationError)
  })

  it('is idempotent: resubmitting an ISBN returns the same suggestion', async () => {
    const { svc } = buildSvc([{ isbn: 'ISBN4', metadata: { title: '重复扫描' } }])
    const first = await svc.submit('ISBN4')
    const second = await svc.submit('ISBN4')
    expect(second.id).toBe(first.id)
  })

  it('approving an unknown suggestion throws NotFound', () => {
    const { svc } = buildSvc([])
    expect(() => svc.approve('nope')).toThrow(NotFoundError)
  })
})