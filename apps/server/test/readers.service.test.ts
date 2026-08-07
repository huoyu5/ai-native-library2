import { describe, it, expect } from 'vitest'
import { ReaderService, ValidationError } from '../src/readers/service.js'

/**
 * Ticket 04 — 读者管理 (Seam 1: 应用服务公共接口)。
 * 领域行为：读者建档与班级/年级关联，无 I/O、无 UI。
 */
describe('ReaderService (Ticket 04, service seam)', () => {
  const service = new ReaderService()

  it('creates a student reader linked to a class and grade', () => {
    const reader = service.create({
      name: '李明',
      kind: 'student',
      classId: 'class-a1',
      grade: '三年级',
    })
    expect(reader.id).toBeTypeOf('string')
    expect(reader.name).toBe('李明')
    expect(reader.kind).toBe('student')
    expect(reader.classId).toBe('class-a1')
    expect(reader.grade).toBe('三年级')
  })

  it('creates a teacher reader', () => {
    const reader = service.create({ name: '王老师', kind: 'teacher' })
    expect(reader.kind).toBe('teacher')
    expect(reader.name).toBe('王老师')
  })

  it('rejects a blank name', () => {
    expect(() => service.create({ name: '', kind: 'student' })).toThrow(ValidationError)
  })

  it('rejects an unknown kind', () => {
    expect(() => service.create({ name: 'x', kind: 'robot' as never })).toThrow(ValidationError)
  })

  it('returns the created reader by id', () => {
    const created = service.create({ name: '赵颖', kind: 'teacher', grade: '初二' })
    const found = service.findById(created.id)
    expect(found?.name).toBe('赵颖')
    expect(found?.grade).toBe('初二')
  })

  it('is undefined for an unknown id', () => {
    expect(service.findById('does-not-exist')).toBeUndefined()
  })

  it('lists all created readers', () => {
    service.create({ name: '一号', kind: 'student' })
    service.create({ name: '二号', kind: 'teacher' })
    expect(service.list().length).toBeGreaterThanOrEqual(2)
  })
})