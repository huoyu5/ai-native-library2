# 部署指南

AI 原生图书管理系统支持**校内服务器自托管**与**云端托管**两种部署形态。

## 自托管部署（校内服务器）

**前提条件**：Docker 已安装（[Docker 安装文档](https://docs.docker.com/get-docker/)）

### 快速启动

```bash
# 1. 克隆仓库
git clone https://github.com/huoyu5/ai-native-library2.git
cd ai-native-library2

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，至少修改 JWT_SECRET 为随机长字符串

# 3. 启动容器
docker compose up -d

# 4. 访问系统
open http://localhost:3000
```

**默认账户**（首次登录后请立即修改密码）：
- 馆员：`librarian` / `librarian123`
- 管理员：`admin` / `admin123`

### AI 供应商配置

系统默认使用 `fake` 供应商（无 AI，全部走关键词检索降级）。若需启用自然语言检索：

```bash
# .env 中配置
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-YOUR_KEY_HERE
```

AI 不可用或超时时，系统自动降级为关键词检索，**不影响正常使用**。

## 云端托管

同一 Docker 镜像可部署到任意容器平台：

### Railway

1. Fork 本仓库
2. 在 [Railway](https://railway.app) 创建新项目，连接 GitHub 仓库
3. Railway 自动检测 Dockerfile 并构建
4. 在环境变量中设置 `JWT_SECRET`、`AI_PROVIDER`、`DEEPSEEK_API_KEY`
5. 部署完成后，Railway 提供公网访问 URL

### Fly.io / Render / Vercel

参考各平台 Docker 部署文档，核心步骤：
1. 连接 GitHub 仓库或推送镜像
2. 设置环境变量（`JWT_SECRET` 必须）
3. 容器监听 `0.0.0.0:3000`

## 数据备份与恢复

系统当前为**内存驻留存储**（适合 MVP 与校内小规模使用）。

### 定期备份

馆员登录后，通过 API 导出全量快照：

```bash
# 获取馆员 token
TOKEN=$(curl -s http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"librarian","password":"librarian123"}' \
  | jq -r .token)

# 导出快照
curl -s http://localhost:3000/api/backup \
  -H "Authorization: Bearer $TOKEN" \
  > backup-$(date +%Y%m%d-%H%M%S).json
```

**推荐备份策略**：
- 每日自动备份（cron 定时任务）
- 保留最近 7 天快照
- 重要操作前手动备份

### 恢复数据

```bash
# 从快照恢复（覆盖当前所有数据）
curl -X POST http://localhost:3000/api/backup/restore \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @backup-20260807-150000.json
```

**灾备演练**：定期测试恢复流程，确保快照可用。

## 容器管理

```bash
# 查看日志
docker compose logs -f

# 重启服务
docker compose restart

# 停止服务
docker compose down

# 更新到最新版本
git pull
docker compose build
docker compose up -d
```

## 端口与防火墙

- 容器监听：`0.0.0.0:3000`
- 校内访问：局域网内通过 `http://<服务器IP>:3000` 访问
- 公网访问：配置反向代理（Nginx/Caddy）+ HTTPS

## 故障排查

**问题**：容器启动后无法访问
- 检查端口占用：`docker ps`，确认 `0.0.0.0:3000->3000/tcp`
- 查看日志：`docker compose logs app`

**问题**：AI 功能不可用
- 检查 `AI_PROVIDER` 与 `DEEPSEEK_API_KEY` 配置
- 系统自动降级，不影响借还与编目功能

**问题**：数据丢失
- 容器重启会丢失内存数据，需从备份恢复
- 生产环境建议对接持久化存储（后续 ticket）

## 下一步

- 迁移到持久化数据库（PostgreSQL / SQLite）
- 容器健康检查与自动重启
- 多副本部署与负载均衡
