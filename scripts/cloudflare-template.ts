import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseJSONC } from "confbox"
import * as v from "valibot"

// Loose: the fields Drop rewrites are checked, and every other Wrangler setting passes through untouched.
const Binding = v.looseObject({
  binding: v.string(),
  id: v.optional(v.string()),
  database_id: v.optional(v.string()),
  database_name: v.optional(v.string()),
  bucket_name: v.optional(v.string()),
})
type Binding = v.InferOutput<typeof Binding>
const Template = v.looseObject({
  name: v.string(),
  compatibility_flags: v.array(v.string()),
  d1_databases: v.array(Binding),
  r2_buckets: v.array(Binding),
  kv_namespaces: v.array(Binding),
  secrets: v.looseObject({ required: v.array(v.string()) }),
})

export const cloudflareTemplate = v.parse(Template, parseJSONC(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")))

// Nitro merges root and generated Wrangler arrays by concatenating them. Keep one binding
// per name, with the template's provisioned ids, and preserve the existing D1 build override.
export function syncCloudflareTemplate(serverDir: string) {
  const file = join(serverDir, "wrangler.json")
  const config = v.parse(Template, JSON.parse(readFileSync(file, "utf8")))
  config.name = cloudflareTemplate.name
  config.compatibility_flags = [...new Set(config.compatibility_flags)]
  for (const key of ["d1_databases", "r2_buckets", "kv_namespaces"] as const) {
    const bindings = new Map<string, Binding>()
    for (const binding of config[key]) {
      if (!bindings.has(binding.binding)) bindings.set(binding.binding, binding)
    }
    for (const templateBinding of cloudflareTemplate[key]) {
      const binding = { ...bindings.get(templateBinding.binding), ...templateBinding }
      if (key === "d1_databases") {
        binding.database_id = process.env.CLOUDFLARE_D1_DATABASE_ID || templateBinding.database_id
        binding.database_name = process.env.CLOUDFLARE_D1_DATABASE_NAME || templateBinding.database_name
      }
      // An unset KV id lets Wrangler provision it, as it did before the deploy button.
      if (key === "kv_namespaces" && binding.id === "00000000000000000000000000000000") delete binding.id
      bindings.set(binding.binding, binding)
    }
    config[key] = [...bindings.values()]
  }
  config.secrets.required = [...new Set(config.secrets.required)]
  writeFileSync(file, JSON.stringify(config, null, 2))
}
