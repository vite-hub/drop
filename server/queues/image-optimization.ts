import { createError, createLogger } from "evlog"
import { runSandbox } from "vite-hub/sandbox"
import { blob } from "vite-hub/blob"
import { detectContentType } from "vite-hub/blob/content-type"
import { defineQueue } from "vite-hub/queue"

export default defineQueue<string>(async ({ payload: key }) => {
  const log = createLogger({
    operation: "image-optimization",
    storage: { key },
  })

  try {
    const [readError, original] = await blob.get(key)
    if (readError) throw readError
    if (!original) throw new Error("Original image is missing.")

    const [error, optimized] = await runSandbox("image-optimizer", { image: original })
    if (error) throw error

    if (detectContentType(new Uint8Array(await optimized.arrayBuffer())) !== original.type)
      throw new Error("Sandbox returned an invalid image.")

    const replaced = optimized.size < original.size
    if (replaced) {
      const [writeError] = await blob.put(key, optimized, { access: "private", contentType: original.type })
      if (writeError) throw writeError
    }

    log.set({
      image: {
        contentType: original.type,
        originalBytes: original.size,
        optimizedBytes: optimized.size,
        replaced,
      },
    })
  }
  catch (error) {
    const failure = createError({
      cause: error instanceof Error ? error : undefined,
      code: "DROP_IMAGE_OPTIMIZATION_FAILED",
      internal: { key },
      message: "Image optimization failed.",
    })
    log.error(failure)
    throw failure
  }
  finally {
    log.emit()
  }
})
