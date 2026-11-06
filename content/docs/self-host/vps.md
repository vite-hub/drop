---
title: Run it on a VPS
description: One Node.js process in Docker, with local SQLite and a Docker volume for all persistent data. Put a reverse proxy in front for HTTPS.
---

::docs-deploy-buttons{host="vps"}
::

::docs-host-facts{host="vps"}
::

## Before you start {#need}

You need a server with Git, Docker Compose, and a domain pointing at it. SQLite, files, and KV stay on your server.

[Create a GitHub OAuth app](/docs/self-host#github) with callback `https://<your-domain>/api/auth/callback/github`. Put your email in `DROP_ADMINS` and generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`.

## Run Drop {#steps}

Paste this on the server. Fill the sign-in settings when the editor opens:

```sh
git clone https://github.com/vite-hub/drop my-drop
cd my-drop
cp .env.example .env
${EDITOR:-nano} .env
docker compose up -d --build
```

Compose builds for `DROP_HOST=vps` and starts Drop, which applies pending migrations before it listens. It binds port 3000 to localhost and keeps the SQLite database, files, and cleanup history in the `drop-data` volume. If migrations fail, the server does not start. A fresh SQLite database needs no data-loss override. If an upgrade refuses an intentional removal, back up the database and review `DROP_HOST=vps pnpm db:migrate --dry-run` before running `DROP_HOST=vps pnpm db:migrate --allow-data-loss` once against that database.

## Serve HTTPS {#proxy}

With [Caddy](https://caddyserver.com), add this to your Caddyfile and reload it:

```caddy
drop.example.com {
  header /f/* Cache-Control "private, no-store"
  reverse_proxy 127.0.0.1:3000 {
    header_up X-Forwarded-For {remote_host}
  }
}
```

Caddy forwards the host and HTTPS scheme and overwrites `X-Forwarded-For` with the connecting client's address. With nginx, use these settings in the location that proxies to Drop:

```nginx
proxy_pass http://127.0.0.1:3000;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $remote_addr;
client_max_body_size 32m;
```

Drop uses only `X-Forwarded-For` for authentication rate limits on a VPS. The proxy must overwrite it, and the backend must be accessible only through that proxy: keep Compose's localhost port binding, or bind a non-Docker server to `127.0.0.1` and block external access to port 3000. Never pass through a client-supplied IP header or use `$proxy_add_x_forwarded_for`. These recipes assume the proxy accepts client connections directly.

nginx's default body limit of 1m answers 413 to any upload over 1 MB; Drop takes files up to 4 MiB and app archives up to about 27 MiB. Keep the OAuth app's homepage and callback on that HTTPS domain.

To [give apps their own domain](/docs/self-host#content-origin), proxy a wildcard hostname (with a wildcard certificate) to the same port, with the same headers, and set `DROP_CONTENT_ORIGIN` to it, such as `https://*.drop-usercontent.example.com`, and `VITEHUB_SECRET` to the output of `openssl rand -base64 32`.

## Settings {#env}

::docs-env
---
extra:
  - ["DROP_DATABASE", "Optional build override: sqlite or d1. Existing D1 database ids keep the D1 driver."]
  - ["DROP_DATABASE_URL", "Runtime SQLite file: URL. Defaults to file:.data/database/drop.db. Keep it on the persistent volume."]
  - ["DROP_MEMBERS", "Optional emails, comma-separated; only these people and the admins may publish, view, and use MCP."]
  - ["DROP_GITHUB_ORG", "Optional active organization membership requirement for publishing, viewing, and MCP."]
  - ["DROP_AUTH_PROXY", "Set true to reuse GitHub oauth2-proxy; requires DROP_GITHUB_ORG."]
  - ["DROP_AUTH_PROXY_COOKIE", "Optional proxy cookie name to clear on logout. Secure, host-only, Path=/."]
  - ["DROP_CONTENT_ORIGIN", "Optional wildcard origin for apps and HTML docs, one subdomain per drop, proxied to the same port. Needs VITEHUB_SECRET."]
---
::

## Reuse GitHub oauth2-proxy {#auth-proxy}

Set `DROP_AUTH_PROXY=true` and `DROP_GITHUB_ORG=your-org`. Native GitHub client credentials are unnecessary in this mode. Configure the existing OAuth app to accept `https://<your-domain>/oauth2/callback`.

Configure oauth2-proxy with `--provider=github`, `--scope=user:email read:org`, `--github-org=your-org`, `--set-xauthrequest=true`, and `--pass-access-token=true`. Forward `X-Auth-Request-Access-Token` from its auth response to Drop. Drop checks that token against GitHub, maps its numeric user id, and creates its normal session. Do not forward client-supplied identity headers.

Use a Secure, host-only proxy cookie with `Path=/`, such as `__Host-drop-auth`, and set `DROP_AUTH_PROXY_COOKIE` to the same name for logout. Keep the Drop backend accessible only through your proxy. Leave the `DROP_CONTENT_ORIGIN` hostname out of oauth2-proxy: it serves no drop content itself.

Browser pages and shared links can require proxy authentication. Exempt `/oauth2`, `/.well-known`, `/mcp`, `/api/mcp`, and Drop's `/api/auth/oauth2` and `/api/auth/jwks` routes from the proxy's browser redirect. MCP clients authenticate with Drop's own OAuth tokens; Drop checks organization membership for their content access too. Exempt `/api/uploads/` as well: the upload URLs `publish` hands out carry a sealed ticket instead of a sign-in, and agents send them with `curl -T`. For [site review](/docs/sites), exempt `/review.js` and `/api/review/comments`.

Successful membership checks expire after five minutes. Failed checks deny access. A token without `read:org` or organization access may require reauthorization.

If a browser cannot connect a site review, check the response from `/review/connect`. A 401 means GitHub rejected the token; open `/signin` to sign in again. A 403 asking for organization access means the OAuth grant needs `read:org` or organization SSO authorization. A membership-required 403 means GitHub returned no active membership. A 503 means verification failed because GitHub was unavailable, returned an invalid response, or rate-limited the request; retry later. The error's `data.code` and `data.githubStatus` distinguish these cases without including credentials. Sign-in and sign-out stay available when a proxy token fails verification.

Keep `/_vitehub/**` and `/api/_vitehub/console/**` behind the same proxy authentication as Drop's browser pages. Forward cookies, the public `Host` and `Origin`, and `X-Auth-Request-Access-Token` on Console requests, including its RPC POSTs. Drop establishes its session from the proxy before the Console checks the verified email against `DROP_ADMINS`; organization membership alone does not grant Console access.

## Keep an existing D1 database {#d1}

Keep the four Cloudflare settings from your existing deployment and optionally set `DROP_DATABASE=d1`. Compose passes the database selection to the build and runs D1 migrations at startup. Changing to SQLite needs a rebuild and a separate data migration.

## Updates and backups {#data}

```sh
git pull
docker compose up -d --build
```

Migrations run on every container start and skip those already applied. Stop Drop before backing up the Docker volume, or use SQLite's backup API and also back up the blobs. Rebuilding preserves the volume; `docker compose down -v` deletes it.

Run one instance. Rate limits count in its memory. Code images are SVG, and an hourly timer deletes expired images.
