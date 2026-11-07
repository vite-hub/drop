# Drop

## Before you test

Tests that import Nuxt app code need the generated `.nuxt` types even when they don't mount Nuxt. After a fresh install, run `pnpm run postinstall` once before them, or they fail with `Tsconfig not found` before any assertion runs.

## Cases to add when the change touches them

These come from bugs that passed the existing tests and were found after merge. Each applies only when the diff touches its area.

- **Database columns or migrations** (`server/databases/`): add a new migration; never edit one that has shipped. Upgrade a database whose earlier migrations are already recorded, then run a lookup that uses the new field. For the Cloudflare deployment, check that the new migration is in D1's ledger before checking that lookup on the deployed Worker. (drop#28 edited an applied `0000_init.sql`; drop#72 deployed a migration D1 never applied, and every lookup returned 500.)
- **Review toolbar events or comment anchoring**: open a real popover or tooltip on the reviewed page, then start a comment, through both the reviewed-site script and an HTML drop's frame. Check that the popover stays open while you write and that the saved comment is still reachable after it closes. (drop#36 closed Portal's Bookmarks popover on Comment; drop#45 closed a prototype tooltip across the iframe and anchored the comment to the whole page.)
- **Prototype labels or canvas zoom**: use long names and two-line notes, at fit-to-canvas and at a lower zoom. Check for clipped text, alignment with the item below, and overlap with neighbours. (drop#124 truncated names, visible in its own screenshots; drop#125 misaligned wider labels.)
