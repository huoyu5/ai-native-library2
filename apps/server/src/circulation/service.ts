import { randomUUID } from 'node:crypto'
import type { ReaderService, ReaderKind } from '../readers/service.js'
import type { CatalogService } from '../catalog/service.js'

/**
 * Ticket 05 — 个人借阅闭环 (Seam 1: 应用服务公共接口)。
 * 状态转换：借出 → 归还 / 逾期。政策边界：同时借出上限、学生 2 周/教师 4 周。
 * 默认政策内建（借阅政策可配置在 Ticket 06 演进）。
 */

export type LoanStatus = 'active' | 'returned' | 'overdue'

export interface Loan {
  id: string
  readerId: string
  /** 借出的副本条码 */
  barcode: string
  loanedAt: string
  dueAt: string
  returnedAt?: string
}

export interface LoanPolicy {
  maxActiveLoansPerReader: number
  loanWeeksByReaderKind: Record<ReaderKind, number>
}

export const DEFAULT_LOAN_POLICY: LoanPolicy = {
  maxActiveLoansPerReader: 5,
  loanWeeksByReaderKind: { student: 2, teacher: 4 },
}

export class LoanLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LoanLimitError'
  }
}

export class CopyUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CopyUnavailableError'
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class CirculationService {
  private loans = new Map<string, Loan>()

  constructor(
    private readonly readers: ReaderService,
    private readonly catalog: CatalogService,
    private readonly policy: LoanPolicy = DEFAULT_LOAN_POLICY,
  ) {}

  checkOut(readerId: string, barcode: string, now: Date = new Date()): Loan {
    const reader = this.readers.findById(readerId)
    if (!reader) throw new NotFoundError('reader not found')

    const copy = this.catalog.findCopyByBarcode(barcode)
    if (!copy) throw new NotFoundError('copy not found')

    if (this.activeLoanByBarcode(barcode)) {
      throw new CopyUnavailableError(`copy already on loan: ${barcode}`)
    }

    if (this.activeLoansOf(readerId).length >= this.policy.maxActiveLoansPerReader) {
      throw new LoanLimitError(`reader has reached the ${this.policy.maxActiveLoansPerReader}-loan limit`)
    }

    const weeks = this.policy.loanWeeksByReaderKind[reader.kind]
    const dueAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000).toISOString()

    const loan: Loan = {
      id: randomUUID(),
      readerId,
      barcode,
      loanedAt: now.toISOString(),
      dueAt,
    }
    this.loans.set(loan.id, loan)
    return loan
  }

  returnCopy(barcode: string, now: Date = new Date()): Loan {
    const loan = this.activeLoanByBarcode(barcode)
    if (!loan) throw new NotFoundError(`no active loan for copy: ${barcode}`)
    loan.returnedAt = now.toISOString()
    return loan
  }

  statusOf(loanId: string, now: Date = new Date()): LoanStatus {
    const loan = this.find(loanId)
    if (!loan) throw new NotFoundError('loan not found')
    if (loan.returnedAt) return 'returned'
    return loan.dueAt < now.toISOString() ? 'overdue' : 'active'
  }

  /** 某读者当前（未归还）借阅。 */
  activeLoansOf(readerId: string): Loan[] {
    return [...this.loans.values()].filter((l) => l.readerId === readerId && !l.returnedAt)
  }

  find(loanId: string): Loan | undefined {
    return this.loans.get(loanId)
  }

  allLoans(): Loan[] {
    return [...this.loans.values()]
  }

  private activeLoanByBarcode(barcode: string): Loan | undefined {
    return [...this.loans.values()].find((l) => l.barcode === barcode && !l.returnedAt)
  }
}