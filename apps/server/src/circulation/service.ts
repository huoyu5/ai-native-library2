import { randomUUID } from 'node:crypto'
import type { ReaderService, ReaderKind } from '../readers/service.js'
import type { CatalogService } from '../catalog/service.js'
import { DEFAULT_LOAN_POLICY, type LoanPolicy } from '../policy/service.js'

/**
 * Ticket 05 — 个人借阅闭环 (Seam 1: 应用服务公共接口)。
 * 状态转换：借出 → 归还 / 逾期。政策边界：同时借出上限、学生 2 周/教师 4 周。
 * 政策可配置（Ticket 06）：每次借出实时读取当前政策（`readPolicy` getter）。
 */

export type LoanStatus = 'active' | 'returned' | 'overdue'

export interface Loan {
  id: string
  /** 借阅人：个人借阅为读者 id；班级套书借阅为合成占位 `class:<班级名>`。 */
  readerId: string
  /** 借出的副本条码 */
  barcode: string
  loanedAt: string
  dueAt: string
  returnedAt?: string
  /** 借阅类型：individual 个人借阅 / class 班级套书（Ticket 07）。 */
  kind: 'individual' | 'class'
  /** 班级套书借阅时为班级名，否则 undefined */
  className?: string
  /** 已续借次数（Ticket 07）。 */
  renewCount: number
}

/** 逾期借阅视图：借用 + 读者摘要（Ticket 08）。 */
export interface OverdueLoan extends Loan {
  reader: { id: string; name: string; kind: ReaderKind }
}

export type { LoanPolicy }

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

export class RenewalLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RenewalLimitError'
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class CirculationService {
  private loans = new Map<string, Loan>()

  constructor(
    private readonly readers: ReaderService,
    private readonly catalog: CatalogService,
    private readonly readPolicy: () => LoanPolicy = () => DEFAULT_LOAN_POLICY,
  ) {}

  checkOut(readerId: string, barcode: string, now: Date = new Date()): Loan {
    const reader = this.readers.findById(readerId)
    if (!reader) throw new NotFoundError('reader not found')

    const copy = this.catalog.findCopyByBarcode(barcode)
    if (!copy) throw new NotFoundError('copy not found')

    if (this.activeLoanByBarcode(barcode)) {
      throw new CopyUnavailableError(`copy already on loan: ${barcode}`)
    }

    const policy = this.readPolicy()
    if (this.activeLoansOf(readerId).length >= policy.maxActiveLoansPerReader) {
      throw new LoanLimitError(`reader has reached the ${policy.maxActiveLoansPerReader}-loan limit`)
    }

    const weeks = policy.loanWeeksByReaderKind[reader.kind]
    const dueAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000).toISOString()

    const loan: Loan = {
      id: randomUUID(),
      readerId,
      barcode,
      kind: 'individual',
      renewCount: 0,
      loanedAt: now.toISOString(),
      dueAt,
    }
    this.loans.set(loan.id, loan)
    return loan
  }

  /**
   * 续借一次（Ticket 07）：到期日按读者类型期限向后顺延，续借次数 +1。
   * 达到政策 `renewalsAhead` 上限后再续被拒；班级套书不可续借。
   */
  renewLoan(barcode: string, now: Date = new Date()): Loan {
    const loan = this.activeLoanByBarcode(barcode)
    if (!loan) throw new NotFoundError(`no active loan for copy: ${barcode}`)
    if (loan.kind === 'class') {
      throw new RenewalLimitError('class-set loans cannot be renewed')
    }
    const policy = this.readPolicy()
    if (loan.renewCount >= policy.renewalsAhead) {
      throw new RenewalLimitError('this loan has already been renewed the maximum number of times')
    }
    const reader = this.readers.findById(loan.readerId)
    const weeks = policy.loanWeeksByReaderKind[reader?.kind ?? 'student']
    loan.renewCount += 1
    loan.dueAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000).toISOString()
    return loan
  }

  /**
   * 班级套书借出（Ticket 07，spec）：一批副本关联班级、按学期（classLoanWeeks）期限一次借出。
   * 原子性：先对全部条码做存在性与可借校验，任何失败均不落任何记录。
   */
  checkoutClassSet(className: string, barcodes: string[], now: Date = new Date()): Loan[] {
    const name = className.trim()
    if (!name) throw new ValidationError('className is required')
    if (barcodes.length === 0) throw new ValidationError('at least one barcode is required')
    if (new Set(barcodes).size !== barcodes.length) {
      throw new ValidationError('duplicate barcodes are not allowed')
    }

    // 先全量校验，任一条码不可用则整批失败（不产生部分借出）。
    for (const barcode of barcodes) {
      if (!this.catalog.findCopyByBarcode(barcode)) {
        throw new NotFoundError(`copy not found: ${barcode}`)
      }
      if (this.activeLoanByBarcode(barcode)) {
        throw new CopyUnavailableError(`copy already on loan: ${barcode}`)
      }
    }

    const weeks = this.readPolicy().classLoanWeeks
    const dueAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000).toISOString()
    const loans: Loan[] = []
    for (const barcode of barcodes) {
      const loan: Loan = {
        id: randomUUID(),
        readerId: `class:${name}`,
        barcode,
        kind: 'class',
        className: name,
        renewCount: 0,
        loanedAt: now.toISOString(),
        dueAt,
      }
      this.loans.set(loan.id, loan)
      loans.push(loan)
    }
    return loans
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

  /**
   * 逾期借阅列表（Ticket 08）：未归还且已过到期日的借用，附读者信息，按到期升序。
   * 供馆员查看逾期清单（spec #17）与收到读者逾期警告风险。
   */
  overdueLoans(now: Date = new Date()): OverdueLoan[] {
    return [...this.loans.values()]
      .filter((l) => !l.returnedAt && l.dueAt < now.toISOString())
      .sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1))
      .map((l) => {
        const reader = this.readers.findById(l.readerId)
        return {
          ...l,
          reader: { id: l.readerId, name: reader?.name ?? '未知读者', kind: reader?.kind ?? 'student' },
        }
      })
  }

  /** 读者当前是否有逾期中的借用（办理借还时的警告依据）。 */
  hasOverdue(readerId: string, now: Date = new Date()): boolean {
    return [...this.loans.values()].some(
      (l) => l.readerId === readerId && !l.returnedAt && l.dueAt < now.toISOString(),
    )
  }

  /** 副本当前可借状态（公共检索用，Ticket 09）。 */
  copyStatus(barcode: string, now: Date = new Date()): 'available' | 'borrowed' | 'overdue' {
    const loan = this.activeLoanByBarcode(barcode)
    if (!loan) return 'available'
    return loan.dueAt < now.toISOString() ? 'overdue' : 'borrowed'
  }

  find(loanId: string): Loan | undefined {
    return this.loans.get(loanId)
  }

  allLoans(): Loan[] {
    return [...this.loans.values()]
  }

  /** 当前（未归还）借阅列表（供统计/测试断言）。 */
  listActiveLoans(): Loan[] {
    return [...this.loans.values()].filter((l) => !l.returnedAt)
  }

  /** 备份快照（Ticket 14）。 */
  snapshot(): { loans: Loan[] } {
    return { loans: [...this.loans.values()] }
  }

  /** 恢复（Ticket 14）：清空后按快照重建。 */
  restore(data: { loans: Loan[] }): void {
    this.loans.clear()
    for (const loan of data.loans) this.loans.set(loan.id, loan)
  }

  private activeLoanByBarcode(barcode: string): Loan | undefined {
    return [...this.loans.values()].find((l) => l.barcode === barcode && !l.returnedAt)
  }
}