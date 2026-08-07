import { randomUUID } from 'node:crypto'

/**
 * Ticket 04 — 读者管理 (Seam 1: 应用服务公共接口)。
 * 领域行为：读者（学生/教师）建档与班级/年级关联。无 I/O、无 UI。
 * 读者一人一账户、无读者登录（数据隐私，ADR-0002），借阅记录由馆员代查。
 */

export type ReaderKind = 'student' | 'teacher'

export interface Reader {
  id: string
  name: string
  kind: ReaderKind
  /** 学生关联班级 (Class) */
  classId?: string
  /** 学生/教师关联年级 (Grade) */
  grade?: string
  createdAt: string
}

export interface CreateReaderInput {
  name: string
  kind: ReaderKind
  classId?: string
  grade?: string
}

const KINDS: ReaderKind[] = ['student', 'teacher']

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class ReaderService {
  private readers = new Map<string, Reader>()

  create(input: CreateReaderInput): Reader {
    const name = input.name.trim()
    if (!name) throw new ValidationError('name is required')
    if (!KINDS.includes(input.kind)) throw new ValidationError(`invalid kind: ${input.kind}`)

    const reader: Reader = {
      id: randomUUID(),
      name,
      kind: input.kind,
      createdAt: new Date().toISOString(),
    }
    if (input.classId) reader.classId = input.classId
    if (input.grade) reader.grade = input.grade

    this.readers.set(reader.id, reader)
    return reader
  }

  findById(id: string): Reader | undefined {
    return this.readers.get(id)
  }

  list(): Reader[] {
    return [...this.readers.values()]
  }
}