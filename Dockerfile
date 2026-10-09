FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.18.0
COPY . .
ARG CLOUDFLARE_D1_DATABASE_ID
ARG CLOUDFLARE_D1_DATABASE_NAME=my-drop
ARG DROP_DATABASE_URL
ENV DROP_HOST=vps
ENV CLOUDFLARE_D1_DATABASE_ID=$CLOUDFLARE_D1_DATABASE_ID
ENV CLOUDFLARE_D1_DATABASE_NAME=$CLOUDFLARE_D1_DATABASE_NAME
ENV DROP_DATABASE_URL=$DROP_DATABASE_URL
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY --from=build /app/node_modules/.pnpm/@libsql+linux-x64-gnu@*/node_modules/@libsql/linux-x64-gnu/ ./.output/server/node_modules/@libsql/linux-x64-gnu/
COPY scripts/migrate-d1.mjs ./scripts/migrate-d1.mjs
COPY scripts/migrate-sqlite.mjs ./scripts/migrate-sqlite.mjs
COPY server/databases/migrations ./server/databases/migrations
RUN mkdir .data && chown node:node .data
USER node
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "if [ -n \"$DROP_DATABASE_URL\" ]; then node scripts/migrate-sqlite.mjs; else node scripts/migrate-d1.mjs; fi && exec node .output/server/index.mjs"]
