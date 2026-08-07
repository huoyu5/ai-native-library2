import type { ReaderKind } from '../readers/service.js'

/**
 * 借阅政策可配置（Ticket 06，Seam 1）。
 * 管理员可改期限/数量上限/续借次数；借出/续借校验实时读当前政策。
 * 与领域存储一致为内存驻留（重启回默认学校政策）。
 */
export interface LoanPolicy {
  /** 单读者同时可借数量上限 */
  maxActiveLoansPerReader: number
  /** 不同读者类型的借期（周） */
  loanWeeksByReaderKind: Record<ReaderKind, number>
  /** 允许的续借次数 */
  renewalsAhead: number
  /** 班级套书单期借期（周；一学期约 18 周，Ticket 07） */
  classLoanWeeks: number
}

/** 学校默认政策（spec：学生 2 周、教师 4 周、同时 5 本、可续借 1 次、套书一学期）。 */
export const DEFAULT_LOAN_POLICY: LoanPolicy = {
  maxActiveLoansPerReader: 5,
  loanWeeksByReaderKind: { student: 2, teacher: 4 },
  renewalsAhead: 1,
  classLoanWeeks: 18,
}

export class PolicyValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PolicyValidationError'
  }
}

export class LoanPolicyService {
  private policy: LoanPolicy = {
    ...DEFAULT_LOAN_POLICY,
    loanWeeksByReaderKind: { ...DEFAULT_LOAN_POLICY.loanWeeksByReaderKind },
  }

  /** 当前政策快照（不可变副本）。 */
  get(): LoanPolicy {
    const { loanWeeksByReaderKind, ...rest } = this.policy
    return { ...rest, loanWeeksByReaderKind: { ...loanWeeksByReaderKind } }
  }

  /** 部分更新；非法参数报错且不改动任何字段（整体原子）。 */
  update(patch: Partial<LoanPolicy>): LoanPolicy {
    const next: LoanPolicy = {
      ...this.policy,
      loanWeeksByReaderKind: { ...this.policy.loanWeeksByReaderKind },
    }

    if (patch.maxActiveLoansPerReader !== undefined) {
      assertPositiveInt(patch.maxActiveLoansPerReader, 'maxActiveLoansPerReader')
      next.maxActiveLoansPerReader = patch.maxActiveLoansPerReader
    }
    if (patch.renewalsAhead !== undefined) {
      assertNonNegativeInt(patch.renewalsAhead, 'renewalsAhead')
      next.renewalsAhead = patch.renewalsAhead
    }
    if (patch.classLoanWeeks !== undefined) {
      assertPositiveInt(patch.classLoanWeeks, 'classLoanWeeks')
      next.classLoanWeeks = patch.classLoanWeeks
    }
    if (patch.loanWeeksByReaderKind !== undefined) {
      for (const [kind, weeks] of Object.entries(patch.loanWeeksByReaderKind)) {
        assertPositiveInt(weeks, `loanWeeksByReaderKind.${kind}`)
        next.loanWeeksByReaderKind[kind as ReaderKind] = weeks
      }
    }

    this.policy = next
    return this.get()
  }
}

function assertPositiveInt(v: number, what: string): void {
  if (!Number.isInteger(v) || v < 1) {
    throw new PolicyValidationError(`${what} must be a positive integer`)
  }
}

function assertNonNegativeInt(v: number, what: string): void {
  if (!Number.isInteger(v) || v < 0) {
    throw new PolicyValidationError(`${what} must be a non-negative integer`)
  }
}