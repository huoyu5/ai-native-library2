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

  async function api(url: string, init: RequestInit = {}) {
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    </main>
  )
}