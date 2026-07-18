import { defineBlobServeHandler } from "vite-hub/blob"

import { imageKeySchema } from "../../image-key"

export default defineBlobServeHandler({
  headers: {
    "Cache-Control": "public, max-age=300",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
  },
  notFound: "Image not found",
  param: "key",
  schema: imageKeySchema,
})
