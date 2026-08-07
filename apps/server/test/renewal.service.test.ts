import { describe, it, expect } from 'vitest'
import { ReaderService } from '../src/readers/service.js'
import { CatalogService } from '../src/catalog/service.js'
import {
  CirculationService,
  RenewalLimitError,
  NotFoundError,
} from '../src/circulation/service.js'

/**
 * Ticket 07 — 续借（Seam 1）。
 * 不变量：续借延长借期（按读者类型期限）；已续达到政策上限再续被拒。
 */
describe('renewal (Ticket 07, service seam)', () => {
  const readers = new ReaderService()
  const catalog = new CatalogService()
  const circ = new CirculationService(readers, catalog)

  const studentId = readers.create({ name: '续借学生', kind: 'student' }).id
  const titleId = catalog.createTitle({ title: '续借书' }).id
  catalog.addCopy(titleId, { barcode: 'RN-1' })

  const loanedAt = new Date('2026-01-01T00:00:00Z')

  it('renews an active loan: extends due date by the reader term and counts it', () => {
    const loan = circ.checkOut(studentId, 'RN-1', loanedAt)
    expect(loan.dueAt).toBe('2026-01-15T00:00:00.000Z') // student: +2 weeks
    expect(loan.renewCount).toBe(0)

    const renewed = circ.renewLoan('RN-1', new Date('2026-01-10T00:00:00Z'))
    expect(renewed.renewCount).toBe(1)
    expect(renewed.dueAt).toBe('2026-01-24T00:00:00.000Z') // +2 more weeks from renewal time
  })

  it('rejects a second renewal once the policy allowance is used', () => {
    // 上一个用例已续借 1 次（renewalsAhead 默认 1），再次续借被拒
    expect(() => circ.renewLoan('RN-1', new Date('2026-01-11T00:00:00Z'))).toThrow(
      RenewalLimitError,
    )
  })

  it('throws NotFoundError for an unknown or returned barcode', () => {
    expect(() => circ.renewLoan('RN-NOPE', new Date('2026-01-12T00:00:00Z'))).toThrow(NotFoundError)
  })
})