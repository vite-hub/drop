---
title: Run it on a VPS
description: One Node.js process in Docker, with local SQLite and a Docker volume for all persistent data. Put a reverse proxy in front for HTTPS.
---

::docs-deploy-buttons{host="vps"}
::

::docs-host-facts{host="vps"}
::

## Before you start {#need}

You need a server with Docker Compose and a domain pointing at it. SQLite, files, and KV stay on your server.

[Create a GitHub OAuth app](/docs/self-host#github) with callback `https://<your-domain>/api/auth/callback/github`. Put your email in `DROP_ADMINS` and generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`.

## Run Drop {#steps}

Paste this on the server. Fill the sign-in settings when the editor opens:

```sh
mkdir my-drop && cd my-drop
curl -fsSLO https://raw.githubusercontent.com/vite-hub/drop/main/compose.yaml
curl -fsSL https://raw.githubusercontent.com/vite-hub/drop/main/.env.example -o .env
${EDITOR:-nano} .env
docker compose up -d
```

Compose pulls **`ghcr.io/vite-hub/drop`**, Drop's published image for amd64 and arm64, and starts it. It binds port 3000 to localhost and keeps the SQLite database, files, and cleanup history in the `drop-data` volume. Drop applies pending migrations before it listens; if one fails, it doesn't start. `curl -s localhost:3000/api/health` answers with the version it runs.

| Tag | What it runs |
| --- | --- |
| `latest` | The newest release. Compose's default. |
| `0.1.0`, `0.1` | One release, or the newest patch of a minor version. Set `DROP_IMAGE_TAG=0.1` in `.env` to stay on it. |
| `main` | Every change merged into Drop, like drop.vitehub.dev. |
| `sha-<commit>` | One commit, by its first 7 characters. |

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
  - ["DROP_IMAGE_TAG", "Optional image tag for Compose: latest by default, a release such as 0.1, or main."]
  - ["DROP_DATABASE", "Optional, when you build the image yourself: sqlite or d1. Existing D1 database ids keep the D1 driver."]
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

Browser pages and shared links can require proxy authentication. Exempt `/oauth2`, `/.well-known`, `/mcp`, `/api/mcp`, and Drop's `/api/auth/oauth2` and `/api/auth/jwks` routes from the proxy's browser redirect. MCP clients authenticate with Drop's own OAuth tokens; Drop checks organization membership for their content access too. Exempt `/api/uploads/` as well: the upload URLs `publish` hands out carry a sealed ticket instead of a sign-in, and agents send them with `curl -T`. For [site review](/docs/sites), exempt `/review.js`, `/api/review/related`, `/api/review/comments` and the paths under it (resolving and replies), `/api/review/images/`, and, for who's here, `/review-presence.js`, `/api/review/presence`, and the WebSocket path `/api/_vitehub/realtime/presence/`. The toolbar asks `/api/review/related` whether a doc links to the site before connecting. Its other requests send a review token or a presence ticket, not a sign-in, so a proxy redirect breaks their CORS preflight and their WebSocket.

Successful membership checks expire after five minutes. Failed checks deny access. A token without `read:org` or organization access may require reauthorization.

If a browser cannot connect a site review, check the response from `/review/connect`. A 401 means GitHub rejected the token; open `/signin` to sign in again. A 403 asking for organization access means the OAuth grant needs `read:org` or organization SSO authorization. A membership-required 403 means GitHub returned no active membership. A 503 means verification failed because GitHub was unavailable, returned an invalid response, or rate-limited the request; retry later. The error's `data.code` and `data.githubStatus` distinguish these cases without including credentials. Sign-in and sign-out stay available when a proxy token fails verification.

Exempt `POST /_vitehub/rpc` from the proxy too: the [ViteHub Console](/docs/self-host#github) calls it from its own server with a signature, not a sign-in, and Drop refuses any call that its `VITEHUB_CONSOLE_KEY_<NAME>` doesn't verify. Forward the public `Host`, since the signature covers the URL. Drop then lets in only a Console person whose email is in `DROP_ADMINS`; organization membership alone does not grant Console access.

## Keep an existing D1 database {#d1}

The published image uses SQLite: the database is fixed when an image is built. To keep a D1 database, build the image from a checkout with `compose.build.yaml`, and keep the four Cloudflare settings from your existing deployment in `.env`:

```sh
git clone https://github.com/vite-hub/drop my-drop && cd my-drop
cp .env.example .env
${EDITOR:-nano} .env
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

Drop runs the D1 migrations before it starts. To update, `git pull` and run the same command. Changing to SQLite needs a separate data migration.

## Updates and backups {#data}

```sh
docker compose pull
docker compose up -d
```

**Drop backs up its database before it migrates.** When a new image brings migrations, it copies the SQLite file to `.data/database/backups/` in the volume first, and keeps the three newest copies. Release notes say which versions migrate.

To go back, stop Drop, restore the copy from before the upgrade, set `DROP_IMAGE_TAG` in `.env` to the version you ran before, and start it:

```sh
docker compose stop
docker compose run --rm --no-deps --entrypoint sh drop -c \
  'cd .data/database && rm -f drop.db-wal drop.db-shm && cp backups/<file>.db drop.db'
docker compose up -d
```

Drop refuses a migration that would delete existing data, and stops with the statements in its log. Keep the previous tag until that release's notes say how to upgrade.

The copies cover the database only. For files and KV too, stop Drop and back up the whole volume. Pulling a new image keeps the volume; `docker compose down -v` deletes it.

Run one instance. Rate limits count in its memory. Code images are SVG, and an hourly timer deletes expired images.

## Run the image elsewhere {#image}

`ghcr.io/vite-hub/drop` runs on any container platform, such as Kubernetes, with the same settings as `.env`:

| | |
| --- | --- |
| Port | `3000`, or `PORT`. |
| Volume | `/app/.data`, persistent. The image runs as user 1000; on Kubernetes set `fsGroup: 1000`. |
| Instances | One. SQLite has one writer, so replace the old instance before starting the new one (Kubernetes `strategy: Recreate`). |
| Health | `GET /api/health` answers `{ ok, version, commit }` without a sign-in. |

To update, restart it on a moving tag such as `latest`, with the image pulled again (Kubernetes `imagePullPolicy: Always`), or change a pinned tag.
