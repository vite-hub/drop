# Privacy claims and their proof

Every claim in the privacy policy ([PRIVACY.md](PRIVACY.md), [docs](../../../content/docs/extension.md#privacy)) and
in the store listings, with the test or harness check that proves it. A claim with no proof here doesn't go in the
policy. Unit tests run with `pnpm --filter @vite-hub/drop-extension test`, server tests from the repository root, and
harness checks with `pnpm --filter @vite-hub/drop-extension e2e:<name>` after `build:e2e`.

| Claim | Proof |
| --- | --- |
| The extension asks for no site at install; every site permission is optional. | `test/privacy.test.ts` › "asks for no site at install in either browser, and every host is optional"; "the page script is registered at run time and matches no site by itself" |
| It sends data only to the Drop you connect; nothing to its makers, no analytics. | `test/privacy.test.ts` › "the extension's own code names no server but the default Drop"; `test/notes.test.ts` › "refuses paths outside the review API and inside the notes API" |
| Nothing on a site until you press Drop there or turn on a switch. | `test/injection.test.ts` › "a tab nobody pressed gets nothing, not even a probe", "without a grant, nothing runs"; `harness/pill.mjs` › `freshInstall` "a fresh install puts nothing on five sites and asks no Drop anything"; `harness/chromium.mjs` and `harness/firefox.mjs` › `freshProfile` |
| On every page shows the hand only where you have notes or a review. | `test/injection.test.ts` › "on every page only while the permission is held, and only where there are notes or a review"; `harness/pill.mjs` › `handIndexGate` "with the hand on, five note-less sites ask nothing, and a site with a review gets the pill" |
| The list of sites with notes or reviews names no site. | `test/host.test.ts` › "a site with neither notes nor a review costs one index request, then none"; `test/notes.test.ts` › "the index is kept for the browser session and revalidates with its ETag" |
| On a site with no notes and no review, Drop learns the address only on Comment or Highlight. | `test/host.test.ts` › "the pill starts with private notes and asks nothing of the Drop", "connect creates the notes, and the next session and index know them"; `test/notes.test.ts` › "a site without notes answers no session and creates nothing until asked to" |
| A screenshot leaves the browser only on Send. | `harness/pill.mjs` › `comment` "a pressed pill sends a comment to the review only on a real click, with a pixel-exact screenshot" (fails if the fake Drop holds a screenshot before Send) |
| The screenshot shows the visible part of the tab, without Drop's toolbar. | `harness/pill.mjs` › `comment` (compares the upload with the page and checks the pill is absent); `test/host.test.ts` › "capture takes the visible tab of the sender's window, and only while the tab shows" |
| Your face and cursor go only to people on a shared review; notes show no one. | `test/host.test.ts` › "presence asks for a ticket on shared reviews only" |
| Your sign-in never reaches the websites you visit. | `test/router.test.ts` › "no OAuth or review token reaches a content script", "a reply that holds a token is refused"; `test/content-imports.test.ts` › "can't reach the token store or the OAuth code"; `test/host.test.ts` › "open sends the token to Drop's own page, never back to the page"; `harness/pill.mjs` › `noTokens` "no token reaches the page" |
| The sign-in only works for comments, not the rest of your Drop. | `test/oauth.test.ts` › "registers a public client, asks for the notes resource with PKCE S256, and exchanges the code"; `test/auth/extension-oauth.test.mjs` › 3c, 4a, 4b, 4e |
| Notes are private to you, in the Browser notes folder. | `test/review/notes.test.mjs` › "parallel connects make one notes folder and one notes drop, private and kept without a keep slot", "a review session opens on a review the person may comment on, never someone else's notes" |
| One notes drop per exact site address. | `test/review/notes.test.mjs` › "each exact origin gets its own notes drop in the same folder" |
| A review covering the site comes first; you can switch. | `test/host.test.ts` › "a covered site lists its reviews first and resumes the remembered target"; `harness/pill.mjs` › `takeOver`, `targetSwitch` |
| Turning a switch off gives the permission back. | `test/privacy.test.ts` › "gives back the site permission it no longer needs" |
| Disconnecting forgets the sign-in and asks the Drop to cancel it. | `test/privacy.test.ts` › "forgets the sign-in in the browser and asks the Drop to revoke it"; `test/pages/popup.test.ts` › "disconnects, saves the hand, and removes kept sites" |
| Disconnecting on the Agents page cuts the browser off at once. | `test/review/notes.test.mjs` › "Connected agents names the extension, and disconnecting it ends its notes access at once"; `test/auth/extension-oauth.test.mjs` › 5a, 5b, 5c |

## Not claimed

- **"Removing the extension deletes everything it kept."** That is the browser's behavior, not the extension's, and no
  test here can show it. The docs say it under Disconnect as plain fact; the policy doesn't promise it.
- **"Whoever runs that Drop holds what you send."** A statement of who the operator is, not a behavior to test.
