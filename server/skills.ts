import { and, eq, notInArray } from "drizzle-orm"
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

const store: SkillSettingsStore = {
  async get() {
    try {
      const rows = await db.select({ name: switches.name }).from(switches).where(eq(switches.enabled, false))
      return [undefined, rows.map((row) => row.name)]
    } catch (cause) {
      return failed(cause)
    }
  },
  async set(_key, names) {
    const at = Date.now()
    const on = db
      .update(switches)
      .set({ enabled: true, updatedAt: at, updatedBy: null })
      .where(and(eq(switches.enabled, false), notInArray(switches.name, names)))
    try {
      if (!names.length) await on
      else
        await db.batch([
          on,
          db
            .insert(switches)
            .values(names.map((name) => ({ name, enabled: false, updatedAt: at, updatedBy: null })))
            .onConflictDoUpdate({
              target: switches.name,
              set: { enabled: false, updatedAt: at, updatedBy: null },
              setWhere: eq(switches.enabled, true),
            }),
        ])
      return [undefined, undefined]
    } catch (cause) {
      return failed(cause)
    }
  },
}

export default skillSettings(SKILLS, { store })
