/**
 * Sends a form with a file, like `$fetch`, and reports how much of it has gone. `fetch` can't say how far an upload got,
 * so this goes through XMLHttpRequest. A failure rejects with what `$fetch` would have: `status`, `statusText`, and the
 * server's body as `data`, so `errorText` and the plan-limit dialog read it the same way.
 */
export function sendFile<T>(
  url: string,
  body: FormData,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal; method?: string } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(options.method ?? "POST", url)
    request.responseType = "text"
    request.setRequestHeader("accept", "application/json")
    if (options.onProgress) {
      const report = options.onProgress
      request.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable && event.total) report(event.loaded / event.total)
      })
    }
    request.addEventListener("load", () => {
      const data = parseBody(request.responseText)
      if (request.status >= 200 && request.status < 300) {
        options.onProgress?.(1)
        // SAFETY: the caller names the JSON shape its endpoint answers with, as with `$fetch<T>`.
        resolve(data as T)
      } else reject(new SendFileError(request.status, request.statusText || undefined, data))
    })
    request.addEventListener("error", () =>
      reject(
        new SendFileError(
          0,
          undefined,
          undefined,
          "The upload couldn't reach Drop. Check your connection and try again.",
        ),
      ),
    )
    const cancelled = () => reject(new DOMException("The upload was cancelled.", "AbortError"))
    request.addEventListener("abort", cancelled)
    // Aborting before send() fires no event, so an already-aborted signal rejects here.
    if (options.signal?.aborted) return cancelled()
    options.signal?.addEventListener("abort", () => request.abort(), { once: true })
    request.send(body)
  })
}

/** An upload the server refused, shaped like ofetch's FetchError. */
export class SendFileError extends Error {
  constructor(
    readonly status: number,
    // Undefined rather than empty: HTTP/2 sends no status text, and errorText reads the first one that's set.
    readonly statusText: string | undefined,
    readonly data: unknown,
    message = `${status} ${statusText ?? ""}`.trim(),
  ) {
    super(message)
    this.name = "SendFileError"
  }

  get statusCode() {
    return this.status
  }
}

function parseBody(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
