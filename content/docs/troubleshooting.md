---
title: Troubleshooting
description: What you see when something in Drop doesn't work, why it happens, and how to fix it.
---

## Agents and sign-in {#sign-in}

**Every Drop tool call fails with 401.** The agent holds a sign-in that Drop no longer accepts. Someone disconnected that client on the Agents page, or the Drop's database was reset, which removes every connected client. Sign the client out and back in:

| Client      | Do this                                                     |
| ----------- | ----------------------------------------------------------- |
| Codex       | Run `codex mcp logout drop`, then `codex mcp login drop`.   |
| Claude Code | Open `/mcp`, select Drop, and authenticate again.           |
| Others      | Remove the Drop server, add it again, and sign in.          |

Codex keeps trying to renew the old sign-in instead of asking you again, so it won't recover until you log it out. A single 401 the first time a client connects is expected. That's how [sign-in](/docs/agents#sign-in) starts.

**A page says "You're signed out".** Your Drop session ended while the page was open, so its next action came back 401. Press **Sign in**; you come back to the same page.

**A page says "Too many requests."** Drop got too many requests from you in a short time. Wait a moment and press **Try again**.

## Publishing {#publishing}

**`publish` fails with `DROP_LIMIT_REACHED` and `retryable: true`.** You can publish 30 times a minute. Nothing was created or changed. Wait the `retryAfterSeconds` it returns and make the same call once more.

**`publish` fails with `DROP_LIMIT_REACHED` and `retryable: false`.** The plan has hit one of its limits, and the message names which. Nothing was created or changed, and retrying won't help. `list_drops` shows the plan's usage.

| Limit                        | Fix                                                               |
| ---------------------------- | ----------------------------------------------------------------- |
| Drops or storage             | Move drops you no longer need to the Trash.                       |
| Monthly file writes          | Wait for the reset on the first of next month.                    |
| Drops set to Forever (keep)  | Publish with `review` or `temporary`, or free a kept drop.        |
| App files                    | Leave source maps and unused assets out of the build.             |
| App size                     | Compress images, or load large libraries from a CDN.              |

Agents stop here and ask you. They don't retry or delete your work.

**`publish` fails with a list of `line:column rule message` lines.** The Markdown has a block that never closes, broken `{…}` attributes, a component Drop doesn't render, or a problem in an annotated screenshot. Nothing was stored. Fix each line it names and publish again.

**`publish` succeeds with `warnings`.** In an app or HTML page, a script, stylesheet, image, import, `fetch()` path, or link points at nothing you published. In a Markdown doc, it's a smaller problem, such as an image without alt text. The drop is live. Fix what each warning names and publish again with `previous`.

## Comments {#comments}

**"Too many comments in a minute."** Each person can send 20 comments, replies, or edits a minute, on drops and on site reviews. Wait a moment and send again.

## Site reviews {#sites}

**"Your review session ended."** A connection from the site to its review lasts 12 hours, and ends sooner if you lose access to the review. Press **Comment**, or **Send** on the note you wrote, to connect again. Your note is kept.

**The site stays blank when you review it in Drop.** The site refuses to be shown in a frame. Use the [bookmarklet](/docs/sites#bookmarklet), or [add the script](/docs/sites#install) to its preview builds.

**The bookmarklet does nothing.** The page's Content Security Policy blocks it. Add the [script tag](/docs/sites#install) to the site's preview builds instead.

**You can't comment while signed out.** Guests can comment only on a review shared as **Public, anyone comments**. Sign in, or ask the review's owner to share it that way.

## Prototype canvases {#canvas}

These are items made with `data-src`, which show a live page in a frame on a [prototype](/docs/agents#skill) canvas.

**An item shows only its name.** It's asleep. Live pages load as you pan near them, two at a time, and sleep after five seconds out of view. Pan back to it and it loads again.

**An item shows Retry preview.** The page was still loading after 15 seconds, so it gave its turn to the next item. Click **Retry preview**, or pan away and back. An item stays loading while it has focus or while you write or read a comment on it.

**An item stays empty.** The site sends `X-Frame-Options`, or a Content Security Policy `frame-ancestors` that leaves Drop out, so the browser won't show it in a frame. Review that page as a [site review](/docs/sites) with the bookmarklet instead. Before you publish a canvas of live pages, check that one item renders.

**An item loads signed out.** Browsers send a site's usual login cookies (SameSite=Lax) to a frame only when the frame and Drop are on the same site. A preview on `pr123-demo.preview.example.com` inside a Drop on `drop.example.com` keeps your login, since both are `example.com`. On another domain the page loads signed out.

## Self-hosting {#self-host}

**Sign-in fails behind oauth2-proxy.** Check what `/signin/start` answers, and read the error's `data.code`:

| Answer | Why                                                                                  |
| ------ | ------------------------------------------------------------------------------------ |
| 401    | GitHub rejected the token.                                                           |
| 403    | The OAuth grant needs `read:org` or organization SSO, or GitHub found no active membership. |
| 503    | GitHub was down, answered something Drop can't read, or rate-limited the request. Retry later. |

The setup is in [Reuse GitHub oauth2-proxy](/docs/self-host/vps#auth-proxy).
