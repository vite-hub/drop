FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.18.0
COPY . .
ARG CLOUDFLARE_D1_DATABASE_ID
ARG CLOUDFLARE_D1_DATABASE_NAME=my-drop
ARG DROP_DATABASE_URL
ARG DROP_DATABASE
ENV DROP_HOST=vps
ENV CLOUDFLARE_D1_DATABASE_ID=$CLOUDFLARE_D1_DATABASE_ID
ENV CLOUDFLARE_D1_DATABASE_NAME=$CLOUDFLARE_D1_DATABASE_NAME
ENV DROP_DATABASE_URL=$DROP_DATABASE_URL
ENV DROP_DATABASE=$DROP_DATABASE
RUN pnpm install --frozen-lockfile && pnpm build && node --input-type=module -e 'import { writeFileSync } from "node:fs"; import { deployment } from "./scripts/deployment.ts"; writeFileSync(".output/drop-database", deployment().database)'
# Nitro's native dependency tracing needs the platform binary next to its JavaScript package.
RUN mkdir -p .output/server/node_modules/@libsql && cp -r node_modules/.pnpm/@libsql+linux-*/node_modules/@libsql/* .output/server/node_modules/@libsql/

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY scripts/migrate-d1.mjs ./scripts/migrate-d1.mjs
COPY server/databases/migrations ./server/databases/migrations
RUN mkdir .data && chown node:node .data
USER node
ENV HOST=0.0.0.0 PORT=3000
ENV DROP_HOST=vps
EXPOSE 3000
CMD ["sh", "-c", "if [ \"$(cat .output/drop-database)\" = d1 ]; then node scripts/migrate-d1.mjs; fi && exec node .output/server/index.mjs"]
