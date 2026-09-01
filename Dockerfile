# Общий системный слой даёт Prisma одинаковые OpenSSL-библиотеки при generate и runtime.
FROM node:22.22.2-bookworm-slim AS system
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

# Базовый build-слой фиксирует версию pnpm через Corepack.
FROM system AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
WORKDIR /app

# Сначала копируются только manifests: Docker cache не переустанавливает пакеты при правке кода.
FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/mock-provider/package.json apps/mock-provider/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN pnpm install --frozen-lockfile

# Builder генерирует Prisma Client и все четыре приложения monorepo.
FROM dependencies AS builder
COPY . .
RUN pnpm db:generate && pnpm build

# Финальный образ не содержит исходный workspace целиком и работает непривилегированным node.
FROM system AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=builder /app/apps/mock-provider/dist ./apps/mock-provider/dist
COPY --from=builder /app/apps/mock-provider/node_modules ./apps/mock-provider/node_modules
# Angular кладётся в /app/public — именно этот путь раздаёт NestJS API.
COPY --from=builder /app/apps/web/dist/web/browser ./public
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder /app/apps/mock-provider/package.json ./apps/mock-provider/package.json
# Production acceptance запускается одноразовым контейнером и не требует выносить admin token с VDS.
COPY --from=builder /app/tests/production ./tests/production
COPY --from=builder /app/tests/support ./tests/support
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
