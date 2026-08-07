import type { AiService } from '../ai/service.js'
import type { SuggestionFields } from './service.js'

/**
 * 用 AI 补全缺失的编目字段（Ticket 11）。
 * 让 AI 以 JSON 返回值；解析失败或超时按降级处理（不阻塞编目，仅少一些字段）。
 * 字段来源由调用方标注为 `ai`。
 */
export function createAiFill(ai: AiService): (isbn: string, current: SuggestionFields) => Promise<SuggestionFields> {
  return async (isbn, current) => {
    try {
      const prompt = buildPrompt(isbn, current)
      const result = await ai.complete(prompt)
      return parseJsonFields(result.text)
    } catch {
      // AI 供应商错/超时/预算超限 → 优雅降级：本次补全失败，不阻断整体。
      return {}
    }
  }
}

function buildPrompt(isbn: string, current: SuggestionFields): string {
  return [
    '你是图书馆编目助手。请为以下 ISBN 补全缺失的编目字段，只输出 JSON 对象，不要解释。',
    `ISBN: ${isbn}`,
    `已知字段: ${JSON.stringify(current)}`,
    '输出形如 {"title":"...","author":"...","category":"...","publisher":"...","subjects":["..."]}',
  ].join('\n')
}

function parseJsonFields(text: string): SuggestionFields {
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first < 0 || last <= first) return {}
  const json = text.slice(first, last + 1)
  const parsed = JSON.parse(json) as Record<string, unknown>

  const out: SuggestionFields = {}
  if (typeof parsed.title === 'string') out.title = parsed.title
  if (typeof parsed.author === 'string') out.author = parsed.author
  if (typeof parsed.category === 'string') out.category = parsed.category
  if (typeof parsed.publisher === 'string') out.publisher = parsed.publisher
  if (typeof parsed.isbn === 'string') out.isbn = parsed.isbn
  if (Array.isArray(parsed.subjects)) {
    const subjects = parsed.subjects.filter((s): s is string => typeof s === 'string')
    if (subjects.length) out.subjects = subjects
  }
  return out
}