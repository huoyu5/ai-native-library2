import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerAuthRoutes, requireRoles } from './auth/routes.js'
import { ReaderService } from './readers/service.js'
import { registerReaderRoutes } from './readers/routes.js'
import { CatalogService } from './catalog/service.js'
import { registerCatalogRoutes } from './catalog/routes.js'
import { CirculationService } from './circulation/service.js'
import { registerCirculationRoutes } from './circulation/routes.js'
import { LoanPolicyService } from './policy/service.js'
import { registerLoanPolicyRoutes } from './policy/routes.js'
import { SearchService } from './search/service.js'
import { registerSearchRoutes } from './search/routes.js'
import { SemanticSearchService } from './search/semantic.js'
import { createQueryInterpreter } from './search/interpreter.js'
import { AuditLogger } from './audit/service.js'
import { AiService, type AiBudget } from './ai/service.js'
import type { AiProvider } from './ai/provider.js'
import { FakeAiProvider } from './ai/fake.js'
import { DeepSeekProvider } from './ai/deepseek.js'
import { registerAiRoutes } from './ai/routes.js'
import { CatalogingService } from './cataloging/service.js'
import { MemoryCatalogBibProvider } from './cataloging/bib.js'
import { createAiFill } from './cataloging/ai-fill.js'
import { registerCatalogingRoutes } from './cataloging/routes.js'
import { ImportService } from './import/service.js'
import { registerImportRoutes } from './import/routes.js'
import { BackupService } from './backup/service.js'
import { registerBackupRoutes } from './backup/routes.js'

/**
 * Builds the Fastify application without listening, so tests can use `app.inject`.
 * The HTTP/API seam lives here: all future API routes register onto this app.
 */
export interface AiAppConfig {
  /** provider 名；缺省时按环境/降级决定（无 key → fake） */
  provider?: string
  budget?: Partial<AiBudget>
}

export function buildApp(opts?: { jwtSecret?: string; aiConfig?: AiAppConfig }) {
  const app = Fastify({ logger: false })

  // JWT sign/verify (Ticket 02). Secret from env or a dev fallback.
  app.register(jwt, {
    secret: opts?.jwtSecret ?? process.env.JWT_SECRET ?? 'dev-secret-not-for-production',
  })

  app.get('/health', async () => ({ status: 'ok' }))

  // 认证与角色 (Ticket 02)
  registerAuthRoutes(app)

  // 受保护占位路由 —— 角色门（Seam 2 权限校验）。
  // 业务操作仅馆员；系统管理仅管理员；二者互斥（spec 角色矩阵）。
  app.get('/api/staff/loans', { preHandler: [requireRoles(app, 'librarian')] }, async () => ({
    loans: [],
  }))

  app.get('/api/admin/users', { preHandler: [requireRoles(app, 'admin')] }, async () => ({
    users: [],
  }))

  // 领域服务（内存驻留，各服务共享实例；后续 ticket 接入真实持久化）
  const readers = new ReaderService()
  const catalog = new CatalogService()
  const policyService = new LoanPolicyService()
  const circulation = new CirculationService(readers, catalog, () => policyService.get())

  // 读者管理 (Ticket 04) —— 馆员业务操作（应用服务 seam + HTTP seam）
  registerReaderRoutes(app, readers)

  // 题名与副本管理 (Ticket 03) —— 目录基础（ADR-0001 简化元数据）
  registerCatalogRoutes(app, catalog)

  // 个人借阅闭环 (Ticket 05)
  registerCirculationRoutes(app, circulation)

  // 借阅政策可配置 (Ticket 06) —— 系统管理员配置，实时生效于借出校验
  registerLoanPolicyRoutes(app, policyService)

  // 公共检索 (Ticket 09) —— 免登录关键词检索（自然语言检索的降级路径）
  const search = new SearchService(catalog, circulation)

  // AI 供应商抽象层 (Ticket 10) —— 管理员可切换 provider / 查询审计
  const audit = new AuditLogger()
  const ai = resolveAi(audit, opts?.aiConfig)
  registerAiRoutes(app, ai, audit)

  // 自然语言检索 (Ticket 12) —— 免登录；AI 仅解析关键词，引用依据由目录命中推导；
  // AI 不可用/超时/输出不可解析时自动降级为关键词检索。
  const semantic = new SemanticSearchService({
    search,
    interpret: createQueryInterpreter(ai),
  })
  registerSearchRoutes(app, search, semantic)

  // 自动编目 + 审核门 (Ticket 11) —— 馆员扫码 ISBN → 建议(标来源) → 审核确认后入库
  // 外部书目库以内存 mock 提供（API seam 验证；真实集成替换 bib 实现即可）。
  const bib = new MemoryCatalogBibProvider(DEMO_BIB)
  const cataloging = new CatalogingService({
    bib,
    aiFill: createAiFill(ai),
    catalog,
  })
  registerCatalogingRoutes(app, cataloging)

  // 初始建库：批量导入 (Ticket 13) —— 复用编目富化管线，预览→修正→确认入库
  const imports = new ImportService({ cataloging, catalog })
  registerImportRoutes(app, imports)

  // 数据备份与恢复 (Ticket 14) —— 馆员可全量导出/恢复快照
  const backup = new BackupService({ readers, catalog, circulation, cataloging, imports })
  registerBackupRoutes(app, backup)

  // 静态资源服务 (Ticket 14 部署) —— 生产环境下 server 兼任前端静态托管（单体部署）
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const webDist = resolve(__dirname, '../../web/dist')
  if (existsSync(webDist)) {
    app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
    })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        reply.code(404).send({ error: 'not found' })
      } else {
        reply.sendFile('index.html')
      }
    })
  }

  return app
}

/** 内置演示书目（离线/浏览器 seam 可用），扫描这些 ISBN 即生成建议。 */
const DEMO_BIB: Array<{ isbn: string; metadata: import('./cataloging/service.js').CatalogMetadata }> = [
  {
    isbn: '9787530215737',
    metadata: {
      title: '夏洛的网',
      author: 'E.B.怀特',
      category: '儿童文学',
      subjects: ['童话', '友谊'],
      publisher: '上海译文出版社',
    },
  },
  {
    isbn: '9787506365437',
    metadata: { title: '活着', author: '余华', category: '小说', publisher: '作家出版社' },
  },
]

/** 供应商解析：默认国内模型（DeepSeek）；无 key、未知 provider 或显式需求时降级到 fake，保证无 AI 也可用（spec「降级」边界）。 */
function resolveAi(audit: AuditLogger, cfg?: AiAppConfig): AiService {
  const providers = new Map<string, AiProvider>()
  providers.set('fake', new FakeAiProvider('fake', (req) => ({ text: `[[fake:${req.prompt}]]` })))
  const deepseekKey = process.env.DEEPSEEK_API_KEY
  if (deepseekKey) providers.set('deepseek', new DeepSeekProvider(deepseekKey))

  const budget: AiBudget = {
    timeoutMs: toNumber(process.env.AI_TIMEOUT_MS, 20_000),
    maxOutputTokens: toNumber(process.env.AI_MAX_OUTPUT_TOKENS, 1000),
    maxCalls: toNumber(process.env.AI_MAX_CALLS, 0),
    ...cfg?.budget,
  }

  const requested =
    cfg?.provider ??
    process.env.AI_PROVIDER ??
    (providers.has('deepseek') ? 'deepseek' : 'fake')
  const defaultName = providers.has(requested) ? requested : 'fake'
  return new AiService(audit, providers, defaultName, budget)
}

function toNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}
