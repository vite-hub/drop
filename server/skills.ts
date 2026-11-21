import { and, eq } from "drizzle-orm"
import { db } from "vite-hub/database"
import { defineErrors, type ResultError } from "vite-hub/runtime"
import { skillSettings, type SkillSettingsStore } from "vite-hub/skills"
import { skillSettings as switches } from "./databases/default/index"
import { SKILLS } from "./utils/skills"

const errors = defineErrors({
  docs: "https://github.com/vite-hub/drop/blob/main/server/skills.ts",
  codes: {
    DROP_SKILL_SETTINGS_QUERY: {
      why: "The skill_settings table could not be read or written.",
      fix: "Check that the Database is reachable and migrated, then try again. The error cause has the query error.",
    },
  },
})

const failed = (cause: unknown): [ResultError, undefined] => [errors.DROP_SKILL_SETTINGS_QUERY({ cause }), undefined]

const get: SkillSettingsStore["get"] = async () => {
  try {
    const rows = await db.select({ name: switches.name }).from(switches).where(eq(switches.enabled, false))
    return [undefined, rows.map((row) => row.name)]
  } catch (cause) {
    return failed(cause)
  }
}

async function writeSwitch(name: string, enabled: boolean): ReturnType<SkillSettingsStore["set"]> {
  const values = { enabled, updatedAt: Date.now(), updatedBy: null }
  try {
    if (enabled) {
      await db
        .update(switches)
        .set(values)
        .where(and(eq(switches.name, name), eq(switches.enabled, false)))
    } else {
      await db
        .insert(switches)
        .values({ name, ...values })
        .onConflictDoUpdate({
          target: switches.name,
          set: values,
          setWhere: eq(switches.enabled, true),
        })
    }
    return [undefined, undefined]
  } catch (cause) {
    return failed(cause)
  }
}

const createSettings = (set: SkillSettingsStore["set"]) => skillSettings(SKILLS, { store: { get, set } })
const createReader = () => createSettings(async () => failed(new Error("The skill settings reader cannot write.")))
let reader = createReader()

export default {
  ...reader,
  enabled: () => reader.enabled(),
  list: () => reader.list(),
  async set(name: string, enabled: boolean) {
    const result = await createSettings(() => writeSwitch(name, enabled)).set(name, enabled)
    if (!result[0]) reader = createReader()
    return result
  },
}
