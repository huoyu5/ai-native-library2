# 部署指南

单套代码支持**校内服务器自托管**与**云端托管**两种形态。系统以**单进程**运行：后端同时提供 API
与前端静态页面，因此部署只需要一个 Node 进程，不需要额外的 Web 服务器。

## 前提条件

- Node.js ≥ 20
- pnpm 9（`corepack enable` 即可启用，仓库已固定版本）

## 一、自托管部署（校内服务器）

### 首次部署

```bash
# 1. 获取代码
git clone https://github.com/huoyu5/ai-native-library2.git
cd ai-native-library2

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，至少把 JWT_SECRET 改成随机长字符串

# 3. 安装依赖并构建（前端产物 + 后端产物）
corepack enable
pnpm install --frozen-lockfile
pnpm build

# 4. 启动（构建 + 启动可用 pnpm serve 一步完成）
pnpm start
```

启动后访问 `http://<服务器IP>:3000`。同一端口同时提供：

- 前端页面（公共检索、自然语言检索、馆员工作台）
- `/api/*` 接口

**默认账户**（上线后请立即修改）：

| 角色 | 用户名 | 密码 |
| --- | --- | --- |
| 馆员 | `librarian` | `librarian123` |
| 管理员 | `admin` | `admin123` |

### 环境变量

`.env.example` 为完整示例，关键项：

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `PORT` | 监听端口 | `3000` |
| `HOST` | 监听地址，`0.0.0.0` 才能被局域网访问 | `0.0.0.0` |
| `JWT_SECRET` | 登录令牌签名密钥，**生产必须修改** | 开发用回退值 |
| `AI_PROVIDER` | `deepseek` 或 `fake`（无 AI） | 有 key 时 `deepseek`，否则 `fake` |
| `DEEPSEEK_API_KEY` | DeepSeek 密钥 | 空 |
| `AI_TIMEOUT_MS` | 单次 AI 调用超时 | `20000` |
| `AI_MAX_OUTPUT_TOKENS` | 单次输出上限（成本护栏） | `1000` |
| `AI_MAX_CALLS` | 调用次数预算，`0` 为不限 | `0` |

Windows PowerShell 下临时设置并启动：

```powershell
$env:PORT = '3000'
$env:JWT_SECRET = '换成随机长字符串'
pnpm start
```

Linux/macOS：

```bash
PORT=3000 JWT_SECRET='换成随机长字符串' pnpm start
```

### 常驻运行

进程需要在关闭终端后继续运行，选一种方式：

**systemd（Linux 校内服务器，推荐）**

```ini
# /etc/systemd/system/ai-library.service
[Unit]
Description=AI Native Library
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/ai-native-library2
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=0.0.0.0
Environment=JWT_SECRET=换成随机长字符串
ExecStart=/usr/bin/node apps/server/dist/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ai-library
sudo systemctl status ai-library
```

**PM2（跨平台）**

```bash
pnpm add -g pm2
pm2 start apps/server/dist/index.js --name ai-library
pm2 save && pm2 startup     # 开机自启
pm2 logs ai-library
```

**Windows 服务**：用 [NSSM](https://nssm.cc/) 把 `node apps/server/dist/index.js` 注册为服务，
工作目录设为仓库根目录。

### 升级

```bash
git pull
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart ai-library   # 或 pm2 restart ai-library
```

### 局域网访问与外网发布

- `HOST=0.0.0.0` 时，校内任意设备可通过 `http://<服务器IP>:3000` 访问。
- 需要对外发布时，在前面加 Nginx/Caddy 反向代理并配置 HTTPS，回源到 `127.0.0.1:3000`。

## 二、云端托管

同一份代码与同一条启动命令可直接跑在任何支持 Node 的托管平台（Railway、Render、Fly.io、
阿里云/腾讯云的 Node 运行环境等）。平台上只需配置三件事：

1. **构建命令**：`pnpm install --frozen-lockfile && pnpm build`
2. **启动命令**：`pnpm start`（即 `node apps/server/dist/index.js`）
3. **环境变量**：`JWT_SECRET` 必填；需要 AI 时补 `AI_PROVIDER=deepseek` 与 `DEEPSEEK_API_KEY`

平台通常会注入自己的 `PORT`，代码已读取 `process.env.PORT`，无需改动。`HOST` 保持 `0.0.0.0`。

## 三、数据备份与恢复

当前数据为**内存驻留**（MVP 与校内小规模够用）：进程重启数据即清空，因此备份是运维必需项。

### 导出备份

```bash
BASE=http://localhost:3000

TOKEN=$(curl -s $BASE/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"librarian","password":"librarian123"}' | jq -r .token)

curl -s $BASE/api/backup -H "Authorization: Bearer $TOKEN" \
  > backup-$(date +%Y%m%d-%H%M%S).json
```

快照包含读者、题名与副本、借阅记录、编目建议、导入批次的全量状态。

### 恢复备份

```bash
curl -s -X POST $BASE/api/backup/restore \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d @backup-20260807-150000.json
```

恢复会**清空现有数据**并以快照重建，用于迁移服务器或灾备回滚。

### 建议策略

- 每日定时备份（Linux 用 cron，Windows 用任务计划程序），保留最近 7 份。
- 批量导入、政策调整等重要操作前手动备份一次。
- 定期演练一次恢复流程，确认快照真的能用。

## 四、故障排查

| 现象 | 排查方向 |
| --- | --- |
| 局域网访问不了 | 确认 `HOST=0.0.0.0`；检查服务器防火墙是否放行该端口 |
| 端口被占用 | 换 `PORT`，或释放占用进程 |
| 页面 404 / 只有接口能用 | 前端产物缺失，重新执行 `pnpm build`（需存在 `apps/web/dist`） |
| 自然语言检索没有 AI 效果 | 检查 `AI_PROVIDER` 与 `DEEPSEEK_API_KEY`；未配置时系统自动降级为关键词检索，功能不中断 |
| 重启后数据没了 | 内存存储的预期行为，从备份恢复 |

## 五、后续演进

- 接入持久化存储（SQLite/PostgreSQL），去掉重启丢数据的限制
- 健康检查与自动重启（`/health` 已提供）
- 备份自动上传到对象存储
