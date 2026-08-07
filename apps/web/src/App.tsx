import { useState, type FormEvent } from 'react'

interface Loan {
  id: string
  readerId: string
  barcode: string
  loanedAt: string
  dueAt: string
  returnedAt?: string
  status: 'active' | 'returned' | 'overdue'
}

interface SearchCopy {
  barcode: string
  shelfLocation?: string
  status: 'available' | 'borrowed' | 'overdue'
}

interface TitleResult {
  id: string
  title: string
  author?: string
  category?: string
  subjects: string[]
  availableShelf?: string
  copies: SearchCopy[]
}

interface MatchReason {
  keyword: string
  field: string
}

interface NaturalResult extends TitleResult {
  score: number
  reasons: MatchReason[]
}

interface NaturalResponse {
  query: string
  mode: 'semantic' | 'keyword'
  degraded: boolean
  interpretation: string
  keywords: string[]
  results: NaturalResult[]
}

interface Suggestion {
  id: string
  isbn: string
  fields: {
    title?: string
    author?: string
    category?: string
    publisher?: string
    isbn?: string
    subjects?: string[]
  }
  fieldSources: Record<string, string>
  status: 'pending' | 'approved' | 'rejected'
  appliedBookId?: string
  rejectedReason?: string
}

/**
 * 馆员工作台（Ticket 05 浏览器 seam）+ 免登录公共检索（Ticket 09 浏览器 seam）。
 * 未登录展示公共检索（关键词）与登录表单；登录后为扫码借还工作台。
 */
export default function App() {
  const [token, setToken] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [readerId, setReaderId] = useState('')
  const [barcode, setBarcode] = useState('')
  const [loans, setLoans] = useState<Loan[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TitleResult[]>([])
  const [nlQuery, setNlQuery] = useState('')
  const [natural, setNatural] = useState<NaturalResponse | null>(null)
  const [isbn, setIsbn] = useState('')
  const [catalogSuggestions, setCatalogSuggestions] = useState<Suggestion[]>([])

  async function api(url: string, init: RequestInit = {}) {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
    }
    return data as Record<string, unknown>
  }

  async function login(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const d = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      setToken(d.token as string)
      setMessage(`已登录：${username}`)
    } catch (err) {
      setError(String(err))
    }
  }

  async function refreshLoans() {
    const d = await api(`/api/loans/reader/${readerId}`)
    setLoans((d.loans as Loan[]) ?? [])
  }

  async function checkout(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await api('/api/loans', { method: 'POST', body: JSON.stringify({ readerId, barcode }) })
      setBarcode('')
      setMessage('借出成功')
      await refreshLoansSat()
    } catch (err) {
      setError(String(err))
    }
  }

  // 借出成功后刷新列表（需 readerId 已填）
  async function refreshLoansSat() {
    if (!readerId) return
    try {
      await refreshLoans()
    } catch {
      /* list refresh is best-effort */
    }
  }

  async function returnCopy(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await api('/api/loans/return', { method: 'POST', body: JSON.stringify({ barcode }) })
      setBarcode('')
      setMessage('归还成功')
      await refreshLoansSat()
    } catch (err) {
      setError(String(err))
    }
  }

  // 免登录公共检索（Ticket 09）：未登录分支使用，api() 不带 Authorization
  async function runSearch(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const d = await api(`/api/search?q=${encodeURIComponent(query)}`)
      setResults((d.results as TitleResult[]) ?? [])
    } catch (err) {
      setError(String(err))
    }
  }

  // 自然语言检索（Ticket 12）：免登录；相关度排序 + 引用依据；AI 不可用自动降级
  async function runNaturalSearch(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const d = await api(`/api/search/natural?q=${encodeURIComponent(nlQuery)}`)
      setNatural({
        query: String(d.query ?? nlQuery),
        mode: d.mode === 'semantic' ? 'semantic' : 'keyword',
        degraded: Boolean(d.degraded),
        interpretation: String(d.interpretation ?? ''),
        keywords: Array.isArray(d.keywords) ? d.keywords.map(String) : [],
        results: (d.results as NaturalResult[]) ?? [],
      })
    } catch (err) {
      setError(String(err))
    }
  }

  // 自动编目 + 审核（Ticket 11）：扫码 ISBN → 建议(标来源) → 馆员确认/拒绝后入库
  async function submitCatalog(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const d = await api('/api/cataloging/submit', {
        method: 'POST',
        body: JSON.stringify({ isbn }),
      })
      const s = d.suggestion as Suggestion
      setIsbn('')
      setCatalogSuggestions((prev) => [s, ...prev.filter((x) => x.id !== s.id)])
      setMessage('已生成编目建议，待审核')
    } catch (err) {
      setError(String(err))
    }
  }

  async function refreshCatalogSuggestions() {
    try {
      const d = await api('/api/cataloging')
      setCatalogSuggestions((d.suggestions as Suggestion[]) ?? [])
    } catch (err) {
      setError(String(err))
    }
  }

  async function approveSuggestion(id: string) {
    setError('')
    try {
      const d = await api(`/api/cataloging/${id}/approve`, { method: 'POST' })
      setCatalogSuggestions((prev) =>
        prev.map((s) => (s.id === id ? (d.suggestion as Suggestion) : s)),
      )
      setMessage('已确认入库')
    } catch (err) {
      setError(String(err))
    }
  }

  async function rejectSuggestion(id: string) {
    setError('')
    try {
      const d = await api(`/api/cataloging/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: '馆员拒绝' }),
      })
      setCatalogSuggestions((prev) =>
        prev.map((s) => (s.id === id ? (d.suggestion as Suggestion) : s)),
      )
      setMessage('已拒绝，不入库')
    } catch (err) {
      setError(String(err))
    }
  }

  if (!token) {
    return (
      <main>
        <h1>AI 原生图书管理系统</h1>
        <p>面向学校与中小型公共图书馆的 AI 原生图书管理系统</p>
        <section>
          <h2>公共检索</h2>
          <form onSubmit={runSearch}>
            <input
              aria-label="检索词"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入题名/作者/关键词"
            />
            <button type="submit">检索</button>
          </form>
          {results.length === 0 ? (
            <p>暂无结果</p>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={r.id}>
                  {r.title}
                  {r.author ? ` · ${r.author}` : ''}
                  {r.availableShelf ? ` · 架位 ${r.availableShelf}` : ' · 暂无在馆副本'}
                  <ul>
                    {r.copies.map((c) => (
                      <li key={c.barcode}>
                        条码 {c.barcode} · {c.status}
                        {c.shelfLocation ? ` · ${c.shelfLocation}` : ''}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2>自然语言检索</h2>
          <form onSubmit={runNaturalSearch}>
            <input
              aria-label="自然语言问题"
              value={nlQuery}
              onChange={(e) => setNlQuery(e.target.value)}
              placeholder="例如：有没有讲友谊的儿童故事？"
            />
            <button type="submit">智能检索</button>
          </form>
          {natural && (
            <div>
              <p>
                理解：{natural.interpretation} · 模式 {natural.mode}
                {natural.degraded ? '（AI 不可用，已降级为关键词检索）' : ''}
              </p>
              {natural.results.length === 0 ? (
                <p>暂无结果</p>
              ) : (
                <ul>
                  {natural.results.map((r) => (
                    <li key={r.id}>
                      {r.title}
                      {r.author ? ` · ${r.author}` : ''}
                      {r.availableShelf ? ` · 架位 ${r.availableShelf}` : ' · 暂无在馆副本'}
                      <ul>
                        {r.reasons.map((reason, idx) => (
                          <li key={`${r.id}-${reason.field}-${idx}`}>
                            依据：{reason.field} 命中「{reason.keyword}」
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
        <section>
          <h2>馆员登录</h2>
          <form onSubmit={login}>
            <input
              aria-label="用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
            />
            <input
              aria-label="密码"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
            />
            <button type="submit">登录</button>
          </form>
          {error && <p role="alert">{error}</p>}
        </section>
      </main>
    )
  }

  return (
    <main>
      <h1>AI 原生图书管理系统</h1>
      <p>
        馆员工作台（已登录）<button onClick={() => setToken(null)}>退出</button>
      </p>
      <p>
        读者 ID <input aria-label="读者ID" value={readerId} onChange={(e) => setReaderId(e.target.value)} />
      </p>
      <section>
        <h2>办理借阅</h2>
        <form onSubmit={checkout}>
          <input
            aria-label="条码"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="扫描/输入副本条码"
          />
          <button type="submit">借出</button>
        </form>
        <form onSubmit={returnCopy}>
          <button type="submit">归还</button>
        </form>
      </section>
      {message && <p>{message}</p>}
      {error && <p role="alert">{error}</p>}
      <section>
        <h2>当前借阅</h2>
        <button onClick={refreshLoans}>刷新</button>
        {loans.length === 0 ? (
          <p>暂无借阅</p>
        ) : (
          <ul>
            {loans.map((l) => (
              <li key={l.id}>
                条码 {l.barcode} · {l.status} · 应还 {l.dueAt}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2>自动编目审核</h2>
        <form onSubmit={submitCatalog}>
          <input
            aria-label="ISBN"
            value={isbn}
            onChange={(e) => setIsbn(e.target.value)}
            placeholder="扫描/输入 ISBN"
          />
          <button type="submit">生成建议</button>
          <button type="button" onClick={refreshCatalogSuggestions}>
            刷新列表
          </button>
        </form>
        {catalogSuggestions.length === 0 ? (
          <p>暂无建议</p>
        ) : (
          <ul>
            {catalogSuggestions.map((s) => (
              <li key={s.id}>
                <strong>{s.fields.title ?? s.isbn}</strong> · ISBN {s.isbn} ·{' '}
                {s.fields.author ? `作者 ${s.fields.author}` : ''}
                {s.fields.publisher ? ` · ${s.fields.publisher}` : ''}
                {s.fields.category ? ` · ${s.fields.category}` : ''} ·{' '}
                {s.status === 'pending' ? (
                  <>
                    <span>待审核</span>{' '}
                    <button onClick={() => approveSuggestion(s.id)}>确认入库</button>{' '}
                    <button onClick={() => rejectSuggestion(s.id)}>拒绝</button>
                  </>
                ) : s.status === 'approved' ? (
                  <span>已入库</span>
                ) : (
                  <span>已拒绝{s.rejectedReason ? `：${s.rejectedReason}` : ''}</span>
                )}
                <ul>
                  {Object.entries(s.fields).map(([key, value]) =>
                    value && Array.isArray(value) ? (
                      <li key={key}>
                        {key}: {value.join('、')}（{s.fieldSources[key] ?? 'ai'}）
                      </li>
                    ) : value ? (
                      <li key={key}>
                        {key}: {String(value)}（{s.fieldSources[key] ?? 'ai'}）
                      </li>
                    ) : null,
                  )}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}