import { escapeUTF8 as escapeHtml } from "entities"

/** The report control belongs to Drop's chrome; user HTML only runs in the sandboxed frame. */
export function htmlLanding(source: string, pathname: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Shared HTML · Drop</title><style>html,body{margin:0;height:100%;font:14px system-ui}body{display:flex;flex-direction:column}header{padding:14px 20px;display:flex;gap:20px;border-bottom:1px solid #ddd}iframe{border:0;flex:1;width:100%;min-height:0}a{color:inherit}</style></head><body><header><a href="/">Drop</a><a href="/report?target=${encodeURIComponent(pathname)}">Report</a><a href="${escapeHtml(pathname)}?raw">Source</a></header><iframe title="Shared HTML" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals" srcdoc="${escapeHtml(source)}"></iframe></body></html>`
}
