import { randomUUID } from 'node:crypto'

/**
 * AI 操作审计日志（Ticket 10，spec「审计」边界）。
 * 内存驻留（与其余领域存储一致）；每次 AI 调用/拒绝/错误都留痕，
 * 供未成年人数据隐私合规回溯（ADR-0002）与管理员审计查询（spec #28）。
 */
export type AuditOutcome = 'fulfilled' | 'rejected' | 'error'

export interface AiUsage {
  prompt: number
  completion: number
}

export interface AuditEntry {
  id: string
  time: string
  kind: 'ai'
  /** 操作者（馆员/管理员）；公共调用（如读者检索）为 undefined */
  operatorId?: string
  provider: string
  prompt: string
  outcome: AuditOutcome
  output?: string
  rejectionReason?: string
  tokens?: AiUsage
}

export class AuditLogger {
  private entries: AuditEntry[] = []

  record(input: Omit<AuditEntry, 'id' | 'time'>): AuditEntry {
    const entry: AuditEntry = { ...input, id: randomUUID(), time: new Date().toISOString() }
    this.entries.push(entry)
    return entry
  }

  /** 最新在前。 */
  list(): AuditEntry[] {
    return [...this.entries].reverse()
  }
}