import type { AiService } from '../ai/service.js'
import type { QueryInterpreter } from './semantic.js'

/**
 * 用 AI 把自然语言查询解析为关键词（Ticket 12）。
 * 约束：只要关键词，不让 AI 生成结果或引用（引用由目录真实命中推导）。
 * 解析失败/超时/输出不可解析 → 抛错，由 SemanticSearchService 降级为关键词检索。
 */
export function createQueryInterpreter(ai: AiService): QueryInterpreter {
  return async (query: string) => {
    const prompt = [
      '你是图书馆检索助手。把读者的自然语言需求转成 3-6 个中文检索关键词。',
      '只输出 JSON，不要解释。keywords 为关键词数组，note 为一句话意图说明。',
      `读者需求: ${query}`,
      '输出形如 {"keywords":["关键词1","关键词2"],"note":"..."}',
    ].join('\n')

    const result = await ai.complete(prompt)
    return parseInterpretation(result.text)
  }
}

function parseInterpretation(text: string): { keywords: string[]; note?: string } {
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first < 0 || last <= first) throw new Error('AI returned no parsable JSON')

  const parsed = JSON.parse(text.slice(first, last + 1)) as Record<string, unknown>
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords.filter((k): k is string => typeof k === 'string')
    : []
  if (keywords.length === 0) throw new Error('AI returned no keywords')

  return {
    keywords,
    ...(typeof parsed.note === 'string' ? { note: parsed.note } : {}),
  }
}