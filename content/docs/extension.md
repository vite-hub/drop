---
title: Browser extension
description: Drop's extension for Chrome and Firefox puts the review toolbar on any website. Comments go to a review of that site, or to your own private notes.
---

## What it does {#what}

The **Drop extension** puts Drop's review toolbar on any website you open, even one you don't run. Click something on the page and write a note about it. Drop saves the note in your Drop with a screenshot, so you can find it and share it later.

It's the same toolbar people get on a [live site review](/docs/sites), with **Comment**, **Highlight**, and **Measure**. The difference is that you don't need anyone to add a script to the site.

## Install {#install}

| Browser | Where to get it |
| --- | --- |
| Chrome | Chrome Web Store. The listing goes live once the extension is published. |
| Firefox 128 or newer | Firefox Add-ons. The listing goes live once the extension is published. |

Installing opens a **welcome page** that walks you through five steps: what Drop does, which Drop you use, connecting your account, where the hand shows, and trying it on example.com. You can skip connecting and do it later from the toolbar button.

The extension asks for no website when you install it. Your browser asks you each time Drop needs a new site, and you can say no. See [Permissions](#permissions).

## Connect your account {#connect}

**Connecting** links the extension to your account on your Drop, so your comments are saved as you. Press **Connect** on the welcome page, in the toolbar button's window, or in the extension's settings.

1. Your browser asks to let Drop talk to your Drop's address. Choose **Allow**.
2. A small Drop window asks whether this browser may save notes to your account. Sign in if you need to, then choose **Allow**.

The extension never sees your password. It gets a sign-in that only works for saving and reading comments, not for the rest of your Drop. Without connecting, **Measure** still works; **Comment** and **Highlight** ask you to connect first.

## Use your own Drop {#own-drop}

The extension uses **drop.vitehub.dev** unless you pick another Drop. If your team runs its own, choose **My own Drop** on the welcome page or under **Your Drop** in the extension's settings, type its address, and press **Check**. Your browser asks to let Drop talk to that address.

| What the check says | What it means |
| --- | --- |
| Found *name* at *address* | It's a Drop. Press **Continue** or **Use this Drop**. |
| That address answered, but it isn't a Drop. | Check the address for typos. |
| That Drop lives at another address. | Your Drop moved. The page offers its real address. |
| This Drop needs an update before the extension works. | Ask whoever runs it to update Drop. |
| Couldn't reach that address. | The address is wrong, or the Drop is down. |

Addresses must start with `https://`. Only a Drop on your own computer (`localhost`) may use `http://`. Changing your Drop disconnects this browser, so connect again afterwards.

## The hand and the toolbar {#toolbar}

The **hand** is Drop's mark on a page. It opens the **toolbar**, the bar of tools at the bottom of the page. You open Drop on a page in three ways:

| Way | How |
| --- | --- |
| Toolbar button | Press Drop next to the address bar. A small window shows the site, your account, and two switches. |
| Keyboard | Press :kbd[Alt] :kbd[Shift] :kbd[D] (:kbd[Option] on a Mac). Press it again to close the toolbar. |
| Right-click | Choose **Comment with Drop** on the page. |

In Chrome, pin the button so it stays next to the address bar: click the puzzle piece, then the pin next to Drop. To change the shortcut, open your browser's extension shortcuts page.

In Chrome, the toolbar comes back as you move between pages of the same site. Firefox forgets the press when the page changes, so press Drop again, or turn on **On this site**. Drop doesn't run on your Drop's own pages, which have their own comments, or on the browser's own pages. On a site that already loads Drop's [review script](/docs/sites#install), the extension takes over, so you see one toolbar.

### Where the hand shows {#hand}

By default, Drop only shows up when you press it. Two switches in the toolbar button's window change that:

| Switch | What it does | Your browser asks for |
| --- | --- | --- |
| **On this site** | The hand comes back every time you open this site. | This one site. |
| **On every page** | The hand shows by itself on every site where you have notes or a review you can comment on. Elsewhere, press Drop as usual. | Every site. |

Turn a switch off and the extension gives that permission back. Settings lists the sites where Drop stays, and you can remove any of them.

## Where comments go {#comments}

A comment goes to one of two places, and the comment box says which before you send:

| Place | When |
| --- | --- |
| **A review of the site** | Someone made a [site review](/docs/sites) that covers this site and you may comment on it. A review always comes first. |
| **My notes** | No review covers the site. Your notes are private: only you see them. |

To switch, open the comment list on the page and pick another place in the list's header. The extension remembers your choice for that site.

**Browser notes** is a private folder in your Drop that holds your notes. Drop makes it the first time you press **Comment** or **Highlight** on a site no review covers, with one notes drop per site. A site here means its exact address, so `app.example.com` and `example.com` get separate notes, as do `http://` and `https://`. Notes are kept until you delete them and don't count against your kept drops. Open them in Drop like any other drop.

## Permissions {#permissions}

Every permission that reaches websites is optional. The extension asks for no site at install, and your browser asks you before Drop can touch one.

| Permission | What Drop uses it for |
| --- | --- |
| **Access to the current tab** (`activeTab`) | Put the toolbar on the page you're on, only after you press Drop, the shortcut, or **Comment with Drop**. It also takes the screenshot for a comment. |
| **Scripting** (`scripting`) | Add the toolbar to that page. |
| **Storage** (`storage`) | Remember your Drop's address, your sign-in, and your settings in this browser. |
| **Identity** (`identity`) | Open the sign-in window for your Drop when you connect. |
| **Context menus** (`contextMenus`) | Add **Comment with Drop** when you right-click a page. |
| **Your Drop's address** (optional) | Talk to your Drop. Asked for when you pick or connect a Drop. |
| **One site** (optional) | Show the hand on that site every time. Asked for when you turn on **On this site**. |
| **Every site** (optional) | Show the hand by itself where you have notes or a review. Asked for when you turn on **On every page**. |

When you turn on **On every page**, your browser warns that Drop can "read and change all your data on all websites". Browsers say that about every extension that shows something on pages. Drop only draws the hand and your comments.

## What's sent, and when {#data}

The extension talks only to the Drop you connect it to, and only after you act.

| You | The extension sends to your Drop |
| --- | --- |
| Install it, or browse without pressing Drop | Nothing. |
| Press Drop on a site, once connected | A request for the list of sites where you have notes or reviews. It names no site. |
| Open Drop on a site that has your notes or a review | That site's address, to find where comments go. |
| Press **Comment** or **Highlight** | That site's address. On a site with no review, this makes your notes for it. |
| Press **Send** | Your comment: the text, the page's address, a description of the element you picked, where you clicked, and a screenshot. |
| Open Drop on a page of a site you've commented on | A request for that page's comments, to show them on the page. |
| Comment on a shared review | Your face and cursor for the others on the review, as on a [live site](/docs/sites#presence). Notes have no one else to show. |

The **screenshot** is of the part of the page you see, without Drop's toolbar. It's taken when you mark something and sent only when you press **Send**.

## Beta {#beta}

The **beta** gets new versions before the stores do. It updates more often and may break. Beta versions have four numbers, like `0.2.0.14`, and the extension's settings say "You're on the beta".

| Browser | How to get the beta |
| --- | --- |
| Firefox | Install the file from the `extension-beta` release on [GitHub](https://github.com/vite-hub/drop/releases). It updates itself. |
| Chrome | A separate **Drop Beta** item in the Chrome Web Store, coming later. |

To leave the beta, remove it and install Drop from your browser's store. Your notes stay in your Drop.

## Disconnect {#disconnect}

To disconnect a browser, open the extension's settings and press **Disconnect** under **Account**. The extension forgets your sign-in and asks your Drop to cancel it.

To cut off a browser you no longer have, open **Agents** in Drop. The extension shows up there as **Browser extension**. Press **Disconnect**, and it can't read or save comments from that moment.

Removing the extension from your browser deletes what it kept there. Your notes and comments stay in your Drop until you delete them.

## Privacy {#privacy}

This section is the privacy policy of the Drop browser extension.

**Who gets your data.** The extension sends data only to the Drop you connect it to: drop.vitehub.dev, unless you choose another. Whoever runs that Drop holds what you send, under that Drop's [terms](/terms). The extension sends nothing to its makers or anyone else: it has no analytics, no ads, and no tracking.

**What it sends, and when.** Nothing on a site until you press Drop there or turn on **On this site** or **On every page**. With them on, it sends only what [What's sent, and when](#data) lists. On a site where you have no notes and no review, Drop learns the site's address only when you press **Comment** or **Highlight**.

**Screenshots.** A screenshot is taken only when you mark something for a comment, and leaves your browser only when you press **Send**. It shows the visible part of the tab, without Drop's toolbar.

**What it keeps in your browser.** Your Drop's address, your sign-in, and your settings: where the hand shows, the sites where Drop stays, and where comments go on each site. Your sign-in never reaches the websites you visit.

**Your notes.** Notes are private to you in your Drop's Browser notes folder. A review's comments are seen by the people that review is shared with.

**Your control.** Every site permission is optional and can be taken back in the extension's settings or your browser's. [Disconnect](#disconnect) the extension in its settings, or on Drop's Agents page. Delete notes and comments in Drop.

**Questions.** Contact whoever runs your Drop through its [contact page](/abuse), or open an issue at [github.com/vite-hub/drop](https://github.com/vite-hub/drop/issues).
