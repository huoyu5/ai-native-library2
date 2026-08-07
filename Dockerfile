# Ticket 14 — 部署（自托管/云端）
#
# 多阶段构建：
#  - web 阶段编译前端静态资源
#  - server 阶段编译后端 + 拷贝 web 产物
#  - 最终镜像单体运行（server 兼任静态文件服务）
#
# 支持校内服务器自托管（docker run）与云端托管（任意容器平台）。

FROM node:20-alpine AS web
WORKDIR /build
COPY package*.json turbo.json ./
COPY apps/web/package*.json apps/web/
RUN npm ci --workspace=apps/web
COPY apps/web apps/web
RUN npm run build --workspace=apps/web

FROM node:20-alpine AS server
WORKDIR /build
COPY package*.json turbo.json ./
COPY apps/server/package*.json apps/server/
RUN npm ci --workspace=apps/server
COPY apps/server apps/server
RUN npm run build --workspace=apps/server

FROM node:20-alpine
WORKDIR /app

# 仅安装生产依赖
COPY package*.json turbo.json ./
COPY apps/server/package*.json apps/server/
RUN npm ci --workspace=apps/server --omit=dev

# 拷贝编译产物
COPY --from=server /build/apps/server/dist apps/server/dist
COPY --from=web /build/apps/web/dist apps/web/dist

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["node", "apps/server/dist/index.js"]