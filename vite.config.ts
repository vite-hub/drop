import { fileURLToPath } from "node:url"

import { nitro } from "nitro/vite"
import { defineConfig } from "vite"
import { vitehub } from "vite-hub"
import { env } from "vite-hub/env"
import { getCloudflareQueueBindingName, getCloudflareQueueName } from "vite-hub/queue"

import packageJson from "./package.json" with { type: "json" }

const domain = "drop.vitehub.dev"
const imageBucketName = `${packageJson.name}-images`
const imageExpiryQueueName = getCloudflareQueueName("image-expiry")

export default defineConfig(({ command }) => ({
  plugins: [
    vitehub({
      agent: false,
      blob: {
        binding: "DROP_IMAGES",
        bucketName: imageBucketName,
        driver: "cloudflare-r2",
      },
      database: false,
      devtools: false,
      kv: command === "serve"
        ? { base: ".data/kv", driver: "fs-lite" }
        : { binding: "DROP_STATS", driver: "cloudflare-kv-binding" },
      queue: { provider: "cloudflare" },
      rateLimit: {
        namespace: packageJson.name,
        provider: command === "serve" ? "memory" : "cloudflare",
      },
      workflow: false,
      workspace: false,
    }),
    nitro({
      cloudflare: {
        deployConfig: true,
        wrangler: {
          name: packageJson.name,
          kv_namespaces: [{ binding: "DROP_STATS", id: "af46608653384ae685850fd7582475be" }],
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
          vars: { DROP_ORIGIN: `https://${domain}` },
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
      serverDir: true,
    }),
  ],
  env: {
    server: {
      dropOrigin: env({ default: `https://${domain}`, source: env.source("DROP_ORIGIN") }),
    },
  },
}))
