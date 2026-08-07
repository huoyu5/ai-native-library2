import { describe, it, expect } from 'vitest'
import { ReaderService } from '../src/readers/service.js'
import { CatalogService } from '../src/catalog/service.js'
import { CirculationService } from '../src/circulation/service.js'

/**
 * Ticket 08 — 逾期视图与警告 (Seam 1: 应用服务公共接口)。
 * 不变量：馆员可枚举逾期借阅（含读者信息）；借还时可查询读者逾期状态。
 */
describe('overdue loans (Ticket 08, service seam)', () => {
  const readers = new ReaderService()
  const catalog = new CatalogService()
  const circ = new CirculationService(readers, catalog)

  const studentId = readers.create({ name: '逾期学生', kind: 'student' }).id
  const teacherId = readers.create({ name: '准时教师', kind: 'teacher' }).id
  const titleId = catalog.createTitle({ title: '逾期书' }).id
  catalog.addCopy(titleId, { barcode: 'OD-1' })
  catalog.addCopy(titleId, { barcode: 'OD-2' })
  catalog.addCopy(titleId, { barcode: 'OD-3' })

  // 借出时间锚点：OD-1/OD-2 学生两周期在 1/15 到期，OD-3 教师四周期在 1/29 到期
  const loanedAt = new Date('2026-01-01T00:00:00Z')
  const checkAt = new Date('2026-01-20T00:00:00Z') // 学生已逾期、教师未逾期

  circ.checkOut(studentId, 'OD-1', loanedAt)
  circ.checkOut(studentId, 'OD-2', loanedAt)
  circ.checkOut(teacherId, 'OD-3', loanedAt) // 教师四周：1/20 尚未到期

  it('lists loans past their due date, with reader info', () => {
    const overdue = circ.overdueLoans(checkAt)
    expect(overdue).toHaveLength(2)
    expect(overdue[0].barcode).toBe('OD-1')
    expect(overdue[0].reader).toEqual({ id: studentId, name: '逾期学生', kind: 'student' })
    expect(overdue[0].dueAt).toBe('2026-01-15T00:00:00.000Z')
  })

  it('excludes loans not yet due and returned loans', () => {
    circ.returnCopy('OD-1')
    const overdue = circ.overdueLoans(new Date('2026-03-01T00:00:00Z'))
    // OD-2 (student, due 1/15) 逾期；OD-3 (teacher, due 1/29) 逾期；OD-1 已还不计
    expect(overdue.map((l) => l.barcode).sort()).toEqual(['OD-2', 'OD-3'])
  })

  it('flags a reader as having an overdue loan (hasOverdue)', () => {
    expect(circ.hasOverdue(studentId, checkAt)).toBe(true)
    expect(circ.hasOverdue(teacherId, checkAt)).toBe(false)
  })

  it('reports no overdue for unknown readers', () => {
    expect(circ.hasOverdue('no-such-reader', new Date('2026-03-01T00:00:00Z'))).toBe(false)
  })
})