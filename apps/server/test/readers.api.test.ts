import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app.js'

/**
 * Ticket 04 — 读者管理 (Seam 2: HTTP/API)。
 * 集成行为：馆员创建/查看读者档案，未认证与越权被拒。
 */
describe('readers API (Ticket 04, HTTP seam)', () => {
  const app = buildApp()

  async function loginAs(username: string, password: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password },
    })
    return res.json().token as string
  }

  it('rejects creating a reader when unauthenticated (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/readers',
      payload: { name: '张三', kind: 'student' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects an admin from creating a reader (403)', async () => {
    const token = await loginAs('admin', 'admin123')
    const res = await app.inject({
      method: 'POST',
      url: '/api/readers',
      payload: { name: '张三', kind: 'student' },
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('lets a librarian create a student reader linked to class and grade (201)', async () => {
    const token = await loginAs('librarian', 'librarian123')
    const res = await app.inject({
      method: 'POST',
      url: '/api/readers',
      payload: { name: '李雷', kind: 'student', classId: 'class-a1', grade: '三年级' },
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.name).toBe('李雷')
    expect(body.kind).toBe('student')
    expect(body.classId).toBe('class-a1')
    expect(body.grade).toBe('三年级')
  })

  it('rejects an invalid reader with 400 (unknown kind)', async () => {
    const token = await loginAs('librarian', 'librarian123')
    const res = await app.inject({
      method: 'POST',
      url: '/api/readers',
      payload: { name: '李雷', kind: 'robot' },
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(400)
  })

  it('lets a librarian list readers (200)', async () => {
    const token = await loginAs('librarian', 'librarian123')
    const res = await app.inject({
      method: 'GET',
      url: '/api/readers',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json().readers)).toBe(true)
  })

  it('returns a reader by id that exists (200)', async () => {
    const token = await loginAs('librarian', 'librarian123')
    const created = await app.inject({
      method: 'POST',
      url: '/api/readers',
      payload: { name: '赵颖', kind: 'teacher', grade: '初二' },
      headers: { authorization: `Bearer ${token}` },
    })
    const id = created.json().id
    const res = await app.inject({
      method: 'GET',
      url: `/api/readers/${id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('赵颖')
  })

  it('returns 404 for an unknown reader id', async () => {
    const token = await loginAs('librarian', 'librarian123')
    const res = await app.inject({
      method: 'GET',
      url: '/api/readers/nope-missing',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })
})