import { decodeHTML } from "entities"

// Figures are screenshots and the landing stories (DocsFigure); the text around them says what they show.
const SKIP = new Set(["script", "style", "svg", "button", "nav", "template", "noscript", "figure"])
const VOID = new Set(["br", "img", "hr", "input", "meta", "link", "source", "wbr"])

interface Frame {
  tag: string
  text: string
  href?: string
  ordered?: boolean
  index?: number
  cells?: string[]
  rows?: string[][]
}

/**
 * Turns the docs pages' own server-rendered HTML into Markdown for agents: headings, paragraphs, lists, links, inline
 * code, code blocks, emphasis, and tables. Built for the markup Drop renders, not arbitrary HTML.
 */
export function htmlToMarkdown(html: string, origin: string): string {
  const stack: Frame[] = [{ tag: "root", text: "" }]
  let skipping = 0
  let list: Frame[] = []
  const top = () => stack[stack.length - 1]!
  const inPre = () => stack.some((frame) => frame.tag === "pre")
  const append = (text: string) => {
    top().text += text
  }

  for (const match of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-z][a-z0-9-]*)([^>]*?)(\/?)>|([^<]+)/gi)) {
    const [, closing, rawTag, attributes = "", selfClosing, text] = match
    if (text !== undefined) {
      if (skipping) continue
      const decoded = decodeHTML(text)
      append(inPre() ? decoded : decoded.replace(/\s+/g, " "))
      continue
    }
    if (!rawTag) continue
    const tag = rawTag.toLowerCase()
    if (SKIP.has(tag)) {
      if (!closing && !selfClosing) skipping++
      else if (closing) skipping = Math.max(0, skipping - 1)
      continue
    }
    if (skipping) continue
    if (!closing) {
      if (tag === "br") {
        append(inPre() ? "\n" : "  \n")
        continue
      }
      if (VOID.has(tag) || selfClosing) continue
      const frame: Frame = { tag, text: "" }
      if (tag === "a") {
        const href = attributes.match(/\bhref="([^"]*)"/)?.[1]
        // A heading's own #anchor link is just its text.
        if (href && !href.startsWith("#")) {
          // Links between docs pages point at their Markdown too.
          const url = new URL(decodeHTML(href), origin)
          if (url.origin === origin && /^\/docs(\/|$)/.test(url.pathname))
            url.pathname = `${url.pathname.replace(/\/$/, "")}.md`
          frame.href = url.href
        }
      }
      if (tag === "ul" || tag === "ol") {
        frame.ordered = tag === "ol"
        frame.index = 0
        list.push(frame)
      }
      if (tag === "table") frame.rows = []
      if (tag === "tr") frame.cells = []
      stack.push(frame)
      continue
    }
    // Close up to the matching tag, so a stray unclosed element can't swallow the rest of the page.
    const at = stack.map((frame) => frame.tag).lastIndexOf(tag)
    if (at <= 0) continue
    while (stack.length > at) {
      const frame = stack.pop()!
      const inner = frame.text
      const parent = top()
      switch (frame.tag) {
        case "h1":
        case "h2":
        case "h3":
        case "h4":
          parent.text += `\n\n${"#".repeat(Number(frame.tag[1]))} ${inner.trim()}\n\n`
          break
        case "p":
        case "div":
        case "section":
        case "header":
        case "article":
        case "main":
          parent.text += `\n\n${inner.trim()}\n\n`
          break
        case "pre":
          parent.text += `\n\n\`\`\`\n${inner.replace(/\n+$/, "")}\n\`\`\`\n\n`
          break
        case "code":
        case "kbd":
          parent.text += inPre() ? inner : `\`${inner}\``
          break
        case "strong":
        case "b":
          parent.text += inner.trim() ? `**${inner.trim()}**` : ""
          break
        case "em":
        case "i":
          parent.text += inner.trim() ? `*${inner.trim()}*` : ""
          break
        case "a":
          parent.text += frame.href && inner.trim() ? `[${inner.trim()}](${frame.href})` : inner
          break
        case "ul":
        case "ol":
          list = list.filter((item) => item !== frame)
          parent.text += `\n\n${inner.replace(/^\n+|\n+$/g, "")}\n\n`
          break
        case "li": {
          const owner = list[list.length - 1]
          const marker = owner?.ordered ? `${(owner.index = (owner.index ?? 0) + 1)}.` : "-"
          const body = inner
            .trim()
            .replace(/\n{3,}/g, "\n\n")
            .replace(/\n/g, `\n${" ".repeat(marker.length + 1)}`)
          parent.text += `\n${marker} ${body}`
          break
        }
        case "td":
        case "th": {
          const row = [...stack].reverse().find((item) => item.tag === "tr")
          row?.cells?.push(
            inner
              .trim()
              .replace(/\|/g, "\\|")
              .replace(/\s*\n\s*/g, " "),
          )
          break
        }
        case "tr": {
          const table = [...stack].reverse().find((item) => item.tag === "table")
          if (frame.cells?.length) table?.rows?.push(frame.cells)
          break
        }
        case "table": {
          const [head, ...body] = frame.rows ?? []
          if (head)
            parent.text += `\n\n| ${head.join(" | ")} |\n|${head.map(() => " --- ").join("|")}|\n${body.map((row) => `| ${row.join(" | ")} |`).join("\n")}\n\n`
          break
        }
        default:
          parent.text += inner
      }
    }
  }
  return (
    stack[0]!.text
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  )
}
