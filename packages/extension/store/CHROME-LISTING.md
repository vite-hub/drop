# Chrome Web Store listing

## Store listing

| Field | Value |
| --- | --- |
| Name | Drop |
| Short description (107 of 132) | Comment on any website. Click anything on a page, write a note, and save it with a screenshot to your Drop. |
| Category | Workflow & Planning |
| Language | English |
| Homepage | https://drop.vitehub.dev/docs/extension |
| Support | https://github.com/vite-hub/drop/issues |
| Privacy policy | https://drop.vitehub.dev/docs/extension#privacy |

### Description

```text
Drop puts a review toolbar on any website, even one you don't run.

Press Drop next to the address bar, then click anything on the page and write a note about it. Drop saves the note with a screenshot of what you saw, so you can find it later, share it, and hand it to the people who fix it.

- Comment: click an element and write a note. Each note keeps a screenshot, the page's address and the element you picked.
- Highlight: draw on the page with a marker, a pen or arrows, and comment on it.
- Measure: check sizes and gaps between elements.
- See your notes on the page again when you come back.

Where comments go
If someone made a review of the site and shared it with you, your comments go to that review, and everyone on it sees them. Otherwise they go to your private notes in your Drop, one set of notes per site. You can switch in the comment list.

Your Drop
The extension works with drop.vitehub.dev, or with your team's own Drop: type its address on the welcome page.

Privacy
The extension asks for no website when you install it. It runs on a page only after you press it, or on sites you choose. It talks only to your Drop: no analytics, no ads, no tracking. A screenshot leaves your browser only when you press Send.

Privacy policy: https://drop.vitehub.dev/docs/extension#privacy
```

### Screenshots

1280×800 PNGs in [`screenshots/`](screenshots/), made by `node harness/store-shots.mjs` from the E2E build
(`pnpm run build:e2e` first; it uses ports 47830 and 47832, so don't run it beside another harness). Upload in this
order, five at most:

| # | File | Shows |
| --- | --- | --- |
| 1 | `pill-comment.png` | Writing a comment on a pricing page, sent to the site's review |
| 2 | `pill-list.png` | The comment list, with the switch for where comments go |
| 3 | `popup.png` | The toolbar button's window: the site, the hand switches, the account |
| 4 | `welcome-1-what.png` | The welcome page's first step |
| 5 | `welcome-4-hand.png` | Choosing where the hand shows |

`welcome-2-where.png` and `welcome-3-connect.png` are spares.

## Privacy practices

### Single purpose

```text
Drop lets a person comment on web pages: it puts a review toolbar on the page they choose and saves their comments, with screenshots, to their own Drop.
```

### Permission justifications

| Permission | Justification |
| --- | --- |
| `activeTab` | Puts the review toolbar on the current tab after the person presses the toolbar button, the keyboard shortcut or the "Comment with Drop" menu item, and takes the screenshot of the visible tab for a comment. |
| `scripting` | Injects the review toolbar's script into the tab the person pressed Drop on, or into a site they chose to keep Drop on. |
| `storage` | Keeps the address of the person's Drop, their sign-in to it, and their settings (where the hand shows, kept sites, where comments go per site) in the browser. |
| `identity` | Opens the sign-in window of the person's Drop (OAuth with PKCE) when they connect the extension. |
| `contextMenus` | Adds "Comment with Drop" to the page's right-click menu. |
| Host permissions (optional, `<all_urls>`) | None at install. The browser asks for one site when the person turns on "On this site", for the person's Drop address when they connect it, and for all sites only when they turn on "On every page"; then the hand shows on every page, and comments load only on sites where they have notes or a review. Turning a switch off gives the permission back. |
| Remote code | No. Every script the extension runs is in the package. |

### Data usage

Tick these data types. All of them go only to the Drop the person connects (drop.vitehub.dev unless they choose
another), and only for the single purpose above.

| Data type | Collected | What and when |
| --- | --- | --- |
| Website content | Yes | When the person presses Send: the comment's screenshot of the visible tab, the description of the element they picked. |
| Web history | Yes | The address of a site and page the person comments on, or opens Drop on where they have notes or a review. |
| User activity | Yes | Where the person clicked for a comment. On a review shared with others, their cursor position while the toolbar is open, shown to the others on that review. |
| Personal communications | Ask Maxi | The comments the person writes. They are notes about the page, not messages, but a shared review shows them to others. |
| Authentication information | Ask Maxi | The sign-in tokens the person's Drop issues. They stay in the browser and go only back to that Drop. |
| Personally identifiable information | Ask Maxi | The account name and email the Drop returns at sign-in, shown in the extension. The extension doesn't send them anywhere. |
| Health, financial and payment, location | No | |

Certify all three:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

<!-- TODO(Maxi): approve the listing, the privacy wording and the three "Ask Maxi" data types before submitting. -->
