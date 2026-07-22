import { runSandbox } from "vite-hub/sandbox"
import { blob } from "vite-hub/blob"
import { detectContentType } from "vite-hub/blob/content-type"
import { defineQueue } from "vite-hub/queue"

export default defineQueue<string>(async ({ payload: id }) => {
  const [readError, original] = await blob.get(id)
  if (readError) throw readError
  if (!original) throw new Error("Original image is missing.")

  const [error, optimized] = await runSandbox("image-optimizer", { image: original })
  if (error) throw error

  if (detectContentType(new Uint8Array(await optimized.arrayBuffer())) !== original.type)
    throw new Error("Sandbox returned an invalid image.")

  if (optimized.size < original.size) {
    const [writeError] = await blob.put(id, optimized, { access: "private", contentType: original.type })
    if (writeError) throw writeError
  }
}, { onError: error => console.error(error) })
