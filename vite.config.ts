import { fileURLToPath } from "node:url"

import { hubBlob } from "@vite-hub/blob/vite"
import { getCloudflareQueueBindingName, getCloudflareQueueName } from "@vite-hub/queue"
import { hubQueue } from "@vite-hub/queue/vite"
import { hubRateLimit } from "@vite-hub/rate-limit/vite"
import { nitro } from "nitro/vite"
import { defineConfig } from "vite"

import packageJson from "./package.json" with { type: "json" }

const domain = "drop.vitehub.dev"
const imageBucketName = `${packageJson.name}-images`
const imageExpiryQueueName = getCloudflareQueueName("image-expiry")

export default defineConfig(({ command }) => ({
  blob: {
    binding: "DROP_IMAGES",
    bucketName: imageBucketName,
    driver: "cloudflare-r2",
  },
  queue: { provider: "cloudflare" },
  plugins: [
    hubBlob(),
    hubQueue(),
    hubRateLimit({
      namespace: packageJson.name,
      provider: command === "serve" ? "memory" : "cloudflare",
    }),
    nitro({
      cloudflare: {
        deployConfig: true,
        wrangler: {
          name: packageJson.name,
          observability: { enabled: true },
          queues: {
            consumers: [{ queue: imageExpiryQueueName }],
            producers: [{
              binding: getCloudflareQueueBindingName("image-expiry"),
              queue: imageExpiryQueueName,
            }],
          },
          r2_buckets: [{ binding: "DROP_IMAGES", bucket_name: imageBucketName }],
          ratelimits: [{
            name: "RATE_LIMIT_696D6167652D75706C6F6164",
            namespace_id: "3576343723",
            simple: { limit: 5, period: 60 },
          }],
          route: { custom_domain: true, pattern: domain },
          vars: { NITRO_DROP_ORIGIN: `https://${domain}` },
        },
      },
      compatibilityDate: "2026-07-17",
      preset: "cloudflare-module",
      publicAssets: [
        {
          baseURL: "/.well-known/skills",
          dir: fileURLToPath(new URL("./skills", import.meta.url)),
          maxAge: 60 * 60 * 24,
        },
      ],
      renderer: false,
      runtimeConfig: { dropOrigin: `https://${domain}` },
      serverDir: true,
    }),
  ],
}))
