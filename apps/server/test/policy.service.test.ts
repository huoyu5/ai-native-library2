import { describe, it, expect, beforeEach } from 'vitest'
import { LoanPolicyService, PolicyValidationError, DEFAULT_LOAN_POLICY } from '../src/policy/service.js'
import { ReaderService } from '../src/readers/service.js'
import { CatalogService } from '../src/catalog/service.js'
import { CirculationService, LoanLimitError } from '../src/circulation/service.js'

/**
 * Ticket 06 — 借阅政策可配置 (Seam 1: 应用服务公共接口)。
 * 不变量：管理员可改政策参数；修改后新借出按新政策校验；web服务 seam 隔离领域行为。
 */
describe('LoanPolicyService (Ticket 06, service seam)', () => {
  it('returns the school default policy', () => {
    const svc = new LoanPolicyService()
    expect(svc.get()).toEqual(DEFAULT_LOAN_POLICY)
  })

  it('updates a subset of parameters and returns the new policy', () => {
    const svc = new LoanPolicyService()
    const updated = svc.update({ maxActiveLoansPerReader: 8 })
    expect(updated.maxActiveLoansPerReader).toBe(8)
    expect(updated.renewalsAhead).toBe(DEFAULT_LOAN_POLICY.renewalsAhead)
    expect(updated.loanWeeksByReaderKind.student).toBe(DEFAULT_LOAN_POLICY.loanWeeksByReaderKind.student)
  })

  it('rejects non-integer and out-of-range parameters without mutating', () => {
    const svc = new LoanPolicyService()
    expect(() => svc.update({ maxActiveLoansPerReader: 0 })).toThrow(PolicyValidationError)
    expect(() => svc.update({ maxActiveLoansPerReader: 1.5 })).toThrow(PolicyValidationError)
    expect(() => svc.update({ renewalsAhead: -1 })).toThrow(PolicyValidationError)
    expect(() => svc.update({ loanWeeksByReaderKind: { student: 0, teacher: 2 } })).toThrow(
      PolicyValidationError,
    )
    expect(svc.get()).toEqual(DEFAULT_LOAN_POLICY)
  })

  it('returns an immutable snapshot (mutating the result does not change the store)', () => {
    const svc = new LoanPolicyService()
    const snap = svc.get()
    snap.maxActiveLoansPerReader = 99
    expect(svc.get().maxActiveLoansPerReader).toBe(DEFAULT_LOAN_POLICY.maxActiveLoansPerReader)
  })
})

describe('policy-driven checkout (Ticket 06, loan limit)', () => {
  let policy: LoanPolicyService
  let circ: CirculationService
  let studentId: string
  let titleId: string

  beforeEach(() => {
    policy = new LoanPolicyService()
    const readers = new ReaderService()
    const catalog = new CatalogService()
    circ = new CirculationService(readers, catalog, () => policy.get())
    const student = readers.create({ name: '政策学生', kind: 'student' })
    studentId = student.id
    const title = catalog.createTitle({ title: '政策书' })
    titleId = title.id
    for (const i of [1, 2, 3, 4]) {
      catalog.addCopy(titleId, { barcode: `P-${i}` })
    }
  })

  it('enforces the current active-loan limit and honors a later raise', () => {
    policy.update({ maxActiveLoansPerReader: 2 })
    for (const b of ['P-1', 'P-2']) circ.checkOut(studentId, b)
    expect(() => circ.checkOut(studentId, 'P-3')).toThrow(LoanLimitError)

    policy.update({ maxActiveLoansPerReader: 3 })
    const loan = circ.checkOut(studentId, 'P-3')
    expect(loan.barcode).toBe('P-3')
  })

  it('computes the due date from current weeks by reader kind', () => {
    policy.update({ loanWeeksByReaderKind: { student: 3, teacher: 4 } })
    const now = new Date('2026-01-01T00:00:00Z')
    const loan = circ.checkOut(studentId, 'P-1', now)
    expect(loan.dueAt).toBe('2026-01-22T00:00:00.000Z')
  })
})