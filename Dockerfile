FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.18.0
# Download dependencies in their own layer, so a rebuild with the same lockfile reuses it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
RUN pnpm fetch
COPY . .
ARG CLOUDFLARE_D1_DATABASE_ID
ARG CLOUDFLARE_D1_DATABASE_NAME=my-drop
ARG DROP_DATABASE_URL
ARG DROP_DATABASE
# The commit /api/health reports. The build context has no .git.
ARG DROP_COMMIT
ENV DROP_COMMIT=$DROP_COMMIT
ENV DROP_HOST=vps
# The image has no git, so `prepare` (vp config) skips the git hooks.
ENV VP_GIT_HOOKS=0
ENV CLOUDFLARE_D1_DATABASE_ID=$CLOUDFLARE_D1_DATABASE_ID
ENV CLOUDFLARE_D1_DATABASE_NAME=$CLOUDFLARE_D1_DATABASE_NAME
ENV DROP_DATABASE_URL=$DROP_DATABASE_URL
ENV DROP_DATABASE=$DROP_DATABASE
RUN pnpm install --frozen-lockfile --offline && pnpm build && node --input-type=module -e 'import { writeFileSync } from "node:fs"; import { deployment } from "./scripts/deployment.ts"; writeFileSync(".output/drop-database", deployment().database)'
# Nitro's native dependency tracing needs the platform binary next to its JavaScript package.
RUN mkdir -p .output/server/node_modules/@libsql && cp -r node_modules/.pnpm/@libsql+linux-*/node_modules/@libsql/* .output/server/node_modules/@libsql/
# The same for mdream, which turns an HTML page into Markdown (Copy as Markdown, agents reading `.md`).
RUN cp -rL "$(dirname "$(readlink -f node_modules/mdream)")/@mdream" .output/server/node_modules/

FROM node:24-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/vite-hub/drop"
LABEL org.opencontainers.image.licenses="BUSL-1.1"
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY scripts/start.mjs scripts/migrate-d1.mjs scripts/migrations.mjs ./scripts/
COPY server/databases/default/migrations ./server/databases/default/migrations
RUN mkdir .data && chown node:node .data
USER node
ENV HOST=0.0.0.0 PORT=3000
ENV DROP_HOST=vps
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# Backs up SQLite before new migrations (or migrates D1), then starts Drop.
CMD ["node", "scripts/start.mjs"]
