---
title: Plurals with Intl.PluralRules
guide: left
---

You'll make a message count read right in English, Spanish and Arabic, with no plural library. Edit the files on the right; the preview runs as you type.

## Count the messages

[main.js](src/main.js) prints one sentence for a few counts. Change `counts` and watch the preview.

The sentence is wrong for one of them. Which one?

```html [index.html]
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <ul id="out"></ul>
    <script type="module" src="./src/main.js"></script>
  </body>
</html>
```

```css [style.css]
body { font: 16px/1.5 system-ui, sans-serif; margin: 24px; color: #18181b; }
ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
li { padding: 10px 14px; border: 1px solid #e4e4e7; border-radius: 10px; }
li b { font-variant-numeric: tabular-nums; }
```

```js [src/main.js]
const counts = [0, 1, 2, 5]

const out = document.querySelector("#out")
for (const count of counts) {
  const li = document.createElement("li")
  li.innerHTML = `<b>${count}</b> new messages`
  out.append(li)
}
```

## Pick the form

`Intl.PluralRules` tells you which form a number takes in a language. In English that's `"one"` or `"other"`:

```js
new Intl.PluralRules("en").select(1) // "one"
new Intl.PluralRules("en").select(5) // "other"
```

[messages.js](src/messages.js) keeps one sentence per form, and [main.js](src/main.js#L1-L4) asks the rules which one to use.

> [!NOTE]
> **Your turn:** the preview still says "1 new messages". Fix `format` in [messages.js](src/messages.js#L6-L9) so 1 reads "1 new message". The console shows each form it picks.

<details>
<summary>Answer</summary>

Return `messages[rules.select(count)]` with the count put in, so `1` takes the `one` form.

</details>

```js [src/messages.js]
export const messages = {
  one: "new message",
  other: "new messages",
}

export function format(count, rules) {
  const form = rules.select(count)
  console.log(count, "→", form)
  return `<b>${count}</b> new messages`
}
```

```js [src/main.js]
import { format } from "./messages.js"

const rules = new Intl.PluralRules("en")
const counts = [0, 1, 2, 5]

const out = document.querySelector("#out")
for (const count of counts) {
  const li = document.createElement("li")
  li.innerHTML = format(count, rules)
  out.append(li)
}
```

## Three languages

English has two forms. Arabic has six: `zero`, `one`, `two`, `few`, `many` and `other`. The same code handles them once each language has its sentences.

[messages.js](src/messages.js) now holds sentences per language, and [main.js](src/main.js) draws one column per language.

| Count | English | Spanish | Arabic |
| --- | --- | --- | --- |
| 0 | other | other | zero |
| 2 | other | other | two |
| 11 | other | other | many |

> [!TIP]
> **Try it:** add `"fr"` to `languages`. French says "0 nouveau message", so 0 takes `one`. The page shows `?` until you add its sentences.

```js [src/messages.js]
export const messages = {
  en: { one: "new message", other: "new messages" },
  es: { one: "mensaje nuevo", other: "mensajes nuevos" },
  ar: {
    zero: "لا رسائل جديدة",
    one: "رسالة جديدة",
    two: "رسالتان جديدتان",
    few: "رسائل جديدة",
    many: "رسالة جديدة",
    other: "رسالة جديدة",
  },
}

export function format(lang, count) {
  const form = new Intl.PluralRules(lang).select(count)
  const text = messages[lang]?.[form] ?? "?"
  return `<b>${count.toLocaleString(lang)}</b> ${text}`
}
```

```js [src/main.js]
import { format } from "./messages.js"

const languages = ["en", "es", "ar"]
const counts = [0, 1, 2, 3, 11, 100]

const out = document.querySelector("#out")
out.style.gridTemplateColumns = `repeat(${languages.length}, 1fr)`
for (const count of counts) {
  for (const lang of languages) {
    const li = document.createElement("li")
    li.dir = lang === "ar" ? "rtl" : "ltr"
    li.innerHTML = format(lang, count)
    out.append(li)
  }
}
```
