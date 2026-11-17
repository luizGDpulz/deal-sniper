# Stage 1: Build TypeScript
FROM --platform=$BUILDPLATFORM node:24-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.9.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile

COPY src ./src
RUN pnpm run build && pnpm prune --prod

# Stage 2: Hardened Non-Root Runtime
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN mkdir -p /app/data && chown -R node:node /app

COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

USER node

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const fs=require('node:fs'); fs.accessSync('/app/data', fs.constants.W_OK); process.exit(0);"

CMD ["node", "dist/main.js"]
