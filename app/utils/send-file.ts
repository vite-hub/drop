import * as v from "valibot"

/**
 * POSTs a form with a file, like `$fetch`, and reports how much of it has gone, from 0 to 1. `fetch` can't say how far
 * an upload got, so this goes through XMLHttpRequest. The answer is read with `schema`. A failure rejects with what
 * `$fetch` would have: `status`, `statusText`, and the server's body as `data`, so `errorText` and the plan-limit dialog
 * read it the same way.
 */
export function sendFile<Schema extends v.GenericSchema>(
  url: string,
  body: FormData,
  schema: Schema,
  options: { onProgress?: (fraction: number) => void } = {},
): Promise<v.InferOutput<Schema>> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open("POST", url)
    request.responseType = "text"
    request.setRequestHeader("accept", "application/json")
    const report = options.onProgress
    if (report)
      request.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable && event.total) report(event.loaded / event.total)
      })
    request.addEventListener("load", () => {
      const data = parseBody(request.responseText)
      if (request.status < 200 || request.status >= 300)
        return reject(new SendFileError(request.status, request.statusText || undefined, data))
      report?.(1)
      const parsed = v.safeParse(schema, data)
      if (parsed.success) resolve(parsed.output)
      else reject(new SendFileError(request.status, "Drop answered the upload with something unexpected.", data))
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
    request.send(body)
  })
}

/** An upload the server refused, shaped like ofetch's FetchError. */
class SendFileError extends Error {
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
