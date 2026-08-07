import { describe, it, expect } from 'vitest'
import { ReaderService } from '../src/readers/service.js'
import { CatalogService } from '../src/catalog/service.js'
import { CirculationService, LoanLimitError, CopyUnavailableError } from '../src/circulation/service.js'

/**
 * Ticket 05 — 个人借阅闭环 (Seam 1: 应用服务公共接口)。
 * 状态转换（借出/归还/逾期）与政策边界（上限 5 本、学生 2 周 / 教师 4 周）。
 */
describe('CirculationService (Ticket 05, service seam)', () => {
  const readers = new ReaderService()
  const catalog = new CatalogService()
  const circ = new CirculationService(readers, catalog)

  const studentId = readers.create({ name: '学生甲', kind: 'student' }).id
  const teacherId = readers.create({ name: '教师乙', kind: 'teacher' }).id
  const titleId = catalog.createTitle({ title: '借阅测试书' }).id
  catalog.addCopy(titleId, { barcode: 'B-900', shelfLocation: 'A区1排' })
  catalog.addCopy(titleId, { barcode: 'B-901' })
  catalog.addCopy(titleId, { barcode: 'B-902' })
  catalog.addCopy(titleId, { barcode: 'B-903' })

  it('checks out a copy to a reader with a due date per policy (student 2 weeks)', () => {
    const now = new Date('2026-03-01T00:00:00Z')
    const loan = circ.checkOut(studentId, 'B-900', now)
    expect(loan.readerId).toBe(studentId)
    expect(loan.barcode).toBe('B-900')
    expect(loan.returnedAt).toBeUndefined()
    expect(loan.dueAt).toBe('2026-03-15T00:00:00.000Z') // student: +2 weeks
  })

  it('gives teachers a 4-week loan term', () => {
    const now = new Date('2026-03-01T00:00:00Z')
    const loan = circ.checkOut(teacherId, 'B-901', now)
    expect(loan.dueAt).toBe('2026-03-29T00:00:00.000Z') // teacher: +4 weeks
  })

  it('rejects checking out a copy that is already on loan', () => {
    expect(() => circ.checkOut(teacherId, 'B-900')).toThrow(CopyUnavailableError)
  })

  it('rejects checking out to a reader already at the loan limit (5 active)', () => {
    const heavy = readers.create({ name: '借书狂', kind: 'teacher' }).id
    const moreCopies = catalog.createTitle({ title: '批量书' }).id
    for (let i = 0; i < 5; i++) {
      catalog.addCopy(moreCopies, { barcode: `B-L${i}` })
      circ.checkOut(heavy, `B-L${i}`)
    }
    expect(circ.activeLoansOf(heavy).length).toBe(5)
    const extra = catalog.createTitle({ title: '多出的一本' }).id
    catalog.addCopy(extra, { barcode: 'B-L99' })
    expect(() => circ.checkOut(heavy, 'B-L99')).toThrow(LoanLimitError)
  })

  it('marks a loan overdue once its due date has passed without return', () => {
    const now = new Date('2026-03-01T00:00:00Z')
    const loan = circ.checkOut(studentId, 'B-902', now)
    const later = new Date('2026-03-20T00:00:00Z') // after 2-week due date
    expect(circ.statusOf(loan.id, later)).toBe('overdue')
  })

  it('is active before the due date', () => {
    const loan = circ.checkOut(studentId, 'B-903')
    expect(circ.statusOf(loan.id)).toBe('active')
  })

  it('returns a copy and makes it available again (can be re-checked-out)', () => {
    const t = catalog.createTitle({ title: '归还测试书' }).id
    catalog.addCopy(t, { barcode: 'B-R1' })
    const r = readers.create({ name: '归还复测者', kind: 'student' }).id
    const now = new Date('2026-04-01T00:00:00Z')
    circ.checkOut(r, 'B-R1', now)
    const returned = circ.returnCopy('B-R1', new Date('2026-04-10T00:00:00Z'))
    expect(returned.returnedAt).toBe('2026-04-10T00:00:00.000Z')
    expect(circ.statusOf(returned.id)).toBe('returned')

    const again = circ.checkOut(r, 'B-R1')
    expect(again.barcode).toBe('B-R1')
    expect(again.returnedAt).toBeUndefined()
  })

  it('throws when returning a copy with no active loan', () => {
    expect(() => circ.returnCopy('B-NEVER-LOANED')).toThrow(Error)
  })

  it('throws NotFound for an unknown reader or barcode on checkout', () => {
    expect(() => circ.checkOut('missing-reader', 'B-900')).toThrow(Error)
    expect(() => circ.checkOut(studentId, 'B-NO-SUCH-COPY')).toThrow(Error)
  })
})