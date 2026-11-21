import * as v from "valibot"

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
        return reject(
          new SendFileError(request.status, request.statusText || undefined, data, {
            requestId: request.getResponseHeader("cf-ray") ?? request.getResponseHeader("x-request-id") ?? undefined,
          }),
        )
      report?.(1)
      const parsed = v.safeParse(schema, data)
      if (parsed.success) resolve(parsed.output)
      else
        reject(
          new SendFileError(request.status, "Drop answered the upload with something unexpected.", data, {
            requestId: request.getResponseHeader("cf-ray") ?? request.getResponseHeader("x-request-id") ?? undefined,
          }),
        )
    })
    request.addEventListener("error", () =>
      reject(
        new SendFileError(0, undefined, undefined, {
          message: "The upload couldn't reach Drop. Check your connection and try again.",
        }),
      ),
    )
    request.send(body)
  })
}

class SendFileError extends Error {
  readonly requestId: string | undefined

  constructor(
    readonly status: number,
    readonly statusText: string | undefined,
    readonly data: unknown,
    { message = `${status} ${statusText ?? ""}`.trim(), requestId }: { message?: string; requestId?: string } = {},
  ) {
    super(message)
    this.name = "SendFileError"
    this.requestId = requestId
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
