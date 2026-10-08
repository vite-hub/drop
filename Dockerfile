FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.18.0
COPY . .
ARG CLOUDFLARE_D1_DATABASE_ID
ARG CLOUDFLARE_D1_DATABASE_NAME=my-drop
ENV DROP_HOST=vps
ENV CLOUDFLARE_D1_DATABASE_ID=$CLOUDFLARE_D1_DATABASE_ID
ENV CLOUDFLARE_D1_DATABASE_NAME=$CLOUDFLARE_D1_DATABASE_NAME
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY scripts/migrate-d1.mjs ./scripts/migrate-d1.mjs
COPY server/databases/migrations ./server/databases/migrations
RUN mkdir .data && chown node:node .data
USER node
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate-d1.mjs && exec node .output/server/index.mjs"]
