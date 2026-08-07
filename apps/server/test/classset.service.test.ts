import { describe, it, expect } from 'vitest'
import { ReaderService } from '../src/readers/service.js'
import { CatalogService } from '../src/catalog/service.js'
import {
  CirculationService,
  CopyUnavailableError,
  NotFoundError,
  ValidationError,
} from '../src/circulation/service.js'

/**
 * Ticket 07 — 班级套书借出（Seam 1）。
 * 不变量：一批副本关联班级、按学期期限一次借出；任一副本不可用时整批原子失败。
 */
describe('class-set checkout (Ticket 07, service seam)', () => {
  const readers = new ReaderService()
  const catalog = new CatalogService()
  const circ = new CirculationService(readers, catalog)

  const titleId = catalog.createTitle({ title: '套书甲' }).id
  const titleId2 = catalog.createTitle({ title: '套书乙' }).id
  catalog.addCopy(titleId, { barcode: 'CS-1' })
  catalog.addCopy(titleId, { barcode: 'CS-2' })
  catalog.addCopy(titleId2, { barcode: 'CS-3' })

  const now = new Date('2026-02-01T00:00:00Z')

  it('creates one loan per barcode linked to the class and a semester due date', () => {
    const loans = circ.checkoutClassSet('三年二班', ['CS-1', 'CS-2', 'CS-3'], now)
    expect(loans).toHaveLength(3)
    for (const loan of loans) {
      expect(loan.className).toBe('三年二班')
      expect(loan.kind).toBe('class')
      expect(loan.renewCount).toBe(0)
      // classLoanWeeks 默认 18 周（一学期）
      expect(loan.dueAt).toBe('2026-06-07T00:00:00.000Z')
    }
  })

  it('rejects an empty barcode list', () => {
    expect(() => circ.checkoutClassSet('三年二班', [], now)).toThrow(ValidationError)
  })

  it('fails atomically when any copy is already on loan', () => {
    catalog.addCopy(titleId, { barcode: 'CS-4' })
    const before = circ.listActiveLoans().length
    // CS-1 已被首个用例借出，CS-4 可用。应先抛不可用，且 CS-4 不被借出。
    expect(() => circ.checkoutClassSet('四年一班', ['CS-1', 'CS-4'], now)).toThrow(
      CopyUnavailableError,
    )
    expect(circ.listActiveLoans().length).toBe(before)
    expect(circ.copyStatus('CS-4', now)).toBe('available')
  })

  it('fails atomically when any copy does not exist', () => {
    catalog.addCopy(titleId, { barcode: 'CS-5' })
    const before = circ.listActiveLoans().length
    // CS-5 存在且可用，但 CS-MISSING 不存在 → 整批失败，CS-5 不得被借出。
    expect(() => circ.checkoutClassSet('四年一班', ['CS-5', 'CS-MISSING'], now)).toThrow(
      NotFoundError,
    )
    expect(circ.listActiveLoans().length).toBe(before)
    expect(circ.copyStatus('CS-5', now)).toBe('available')
  })
})