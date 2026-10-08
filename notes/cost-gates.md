# Cost and content gates handoff

Apply `server/databases/migrations/0003_content_gates.sql` before deploying. It adds permanent blob tombstones, temporary code-image ownership, current drop ids for bounded listings, and a member count maintained by user insert/delete triggers. Pending blob cleanup records become tombstones during the migration. Drop insert/delete/update triggers maintain the current ids, including app ordering after publishes. No new environment variables are required.

The legacy upload cutoff is `2026-10-07T11:48:03Z`, the timestamp of the account rebuild commit `b82ecfc`. Confirm that this precedes the first account-backed production upload. Untracked uploads at or after this timestamp return 404. An upload with a missing or invalid timestamp also returns 404. Tombstones always deny access, even for an older object. Deleted accounts stop serving content too; admins can still delete their drops.

Code images created before this deployment have no owner record and return 404. They would otherwise expire within five minutes. New code images follow their owner's ban immediately. Shared files and pages use `private, no-store` so conditional requests and browser caches recheck access.

Markdown renders now include the source text so warm viewer requests avoid R2. The explicit cache sends a 30-day TTL to the unstorage Cloudflare driver, which sets KV `expirationTtl`. Memory and filesystem caches also check the logical expiry. Deletion removes both the new cache key and the old Nitro render key. Cache deletion failures stay in the blob cleanup queue and remain inaccessible through a tombstone.

Existing old Nitro renders that nobody accesses or deletes still need a one-time KV purge. Run these only after deploying the new renderer, from the coordinator's authorized production checkout. Keep the JSON files outside `/tmp`.

```sh
mkdir -p ~/.cache/fleet/tmp
npx wrangler kv key list --remote --binding KV --config .output/server/wrangler.json --prefix 'nitro-cache:nitro:functions:markdown:' > ~/.cache/fleet/tmp/drop-old-markdown-list.json
node scripts/markdown-cache-keys.mjs ~/.cache/fleet/tmp/drop-old-markdown-list.json > ~/.cache/fleet/tmp/drop-old-markdown-delete.json
npx wrangler kv bulk delete ~/.cache/fleet/tmp/drop-old-markdown-delete.json --remote --binding KV --config .output/server/wrangler.json
```

Review the generated delete list before running the final command. The helper selects only the old render prefix and `.json` suffix. It leaves the new render namespace and other KV data alone. No cloud operations were run in this worktree. The pinned Nitro type is patched to allow the cache-header callback that ViteHub generates when blob serving has an explicit Cache-Control header. Nitro already accepts this callback at runtime; the patch changes only its declaration. No Nitro or ocache upstream PR is required by this brief.

Focused regressions run with `/home/maxi/.local/bin/fleet-queue node --test test/cost/*.test.mjs`. `DROP_TEST_BASELINE=2cf3f55` loads the pre-fix drop utilities, middleware, member count, and code-image store from the original commit to check that the tests detect the original bugs. The harness uses real SQLite migrations, Drizzle queries, handlers, and the Markdown renderer; only framework runtime bindings and caller identity are replaced. The physical TTL check runs the actual unstorage Cloudflare driver against a fake KV binding.

## Verification

- Frozen dependency installation passed through fleet-queue, including the Nitro patch. The Nuxt CLI version stayed pinned to the original lockfile version.
- All 24 cost/content, migration/deployment, and MCP tests passed through fleet-queue. Baseline checks against `2cf3f55` reproduced the original cache, scan, listing, source-read, takedown, deletion/cleanup, member-count, and code-image ownership failures.
- `pnpm typecheck` and the default Cloudflare `pnpm build` passed through fleet-queue.
- Wrangler applied all four migrations successfully to local D1. The built Worker served rendered Markdown and raw source with `private, no-store`. After deleting the source from local R2, raw access returned 404 while the warm render and detail API returned 200. Banning the owner then made the cached render, detail API, and `/d/` page return 404.
- The local Worker preview was stopped. No remote migrations, pushes, merges, or deployments were run.
