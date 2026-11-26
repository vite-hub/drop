import { adoptSqliteLedger } from "../../scripts/adopt-sqlite-ledger.mjs"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { test } from "vite-plus/test"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { migrate } from "drizzle-orm/sqlite-proxy/migrator"
import { migrations as dropMigrations } from "../../scripts/migrations.mjs"

const require = createRequire(import.meta.resolve("vite-hub"))
const { createDbCliContributor } = await import(pathToFileURL(require.resolve("@vite-hub/database/cli")))
const root = fileURLToPath(new URL("../../", import.meta.url))

// What a Docker image on D1 runs when it starts: ViteHub's migrator for D1 over HTTP, on Wrangler's ledger.
async function migrateD1(database) {
  const contributor = createDbCliContributor({}, async () => ({
    rootDir: root,
    databaseNames: ["default"],
    databases: {
      default: {
        name: "default",
        dialect: "sqlite",
        migrationsDir: "server/databases/default/migrations",
        cloudflare: { http: true, databaseId: "test-database" },
      },
    },
  }))
  const migrate = contributor.namespaces[0].features.find((feature) => feature.name === "migrate")
  const previousFetch = globalThis.fetch
  let stderr = ""
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.cloudflare.com/client/v4/accounts/test-account/d1/database/test-database/query")
    const { sql, params } = JSON.parse(options.body)
    let results = []
    if (sql.startsWith("SELECT")) results = database.prepare(sql).all(...(params ?? []))
    else database.exec(`BEGIN; ${sql}; COMMIT;`)
    return Response.json({ success: true, result: [{ success: true, results }] })
  }
  try {
    const context = {
      rootDir: root,
      env: { CLOUDFLARE_ACCOUNT_ID: "test-account", CLOUDFLARE_API_TOKEN: "test-token" },
      stdout: { write() {} },
      stderr: {
        write(value) {
          stderr += value
        },
      },
      spawn() {
        assert.fail("D1 HTTP migrations must not start Drizzle Kit")
      },
    }
    assert.equal(await migrate.run([], context), 0, stderr)
  } finally {
    globalThis.fetch = previousFetch
  }
}

const ledger = (database) =>
  database.prepare("SELECT name FROM sqlite_master WHERE name = 'd1_migrations'").get()
    ? database
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all()
        .map((row) => row.name)
    : []

test.each(["fresh database", "existing Wrangler ledger", "ledger with pins"])(
  "D1 migrations on a %s run only once",
  async (scenario) => {
    const database = new DatabaseSync(":memory:")
    const entries = dropMigrations()
    const pinsMigration = "0016_drop_pins.sql"
    const cascadeMigration = "0018_drop_pin_user_cascade.sql"
    // Indexes tables 0017_comment_sends creates, so no ledger here has it yet.
    const liveKeyMigration = "0020_comment_sends_live_key.sql"
    const applied =
      scenario === "fresh database"
        ? []
        : entries.filter(
            ({ name }) =>
              name !== cascadeMigration &&
              name !== liveKeyMigration &&
              name !== (scenario === "ledger with pins" ? "0017_comment_sends.sql" : pinsMigration),
          )
    const expected = entries.filter((entry) => !applied.includes(entry))
    try {
      if (applied.length) {
        database.exec(
          "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
        )
        for (const { name, sql } of applied) {
          database.exec(sql)
          database.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name)
        }
        database.exec(`
        INSERT INTO user (id, name, email) VALUES ('owner', 'Owner', 'owner@example.com');
        INSERT INTO user (id, name, email) VALUES ('reader', 'Reader', 'reader@example.com');
        INSERT INTO drops (id, owner_id, kind, title, filename, actor_kind, actor_name, created_at, updated_at)
        VALUES ('doc', 'owner', 'markdown', 'Existing doc', 'doc.md', 'browser', 'Owner', 1, 1);
      `)
        if (scenario === "ledger with pins") {
          database.exec(`
          INSERT INTO drop_pins (user_id, drop_id, at) VALUES ('reader', 'doc', 42), ('former-reader', 'doc', 43);
        `)
        } else {
          assert.throws(() => database.prepare("SELECT at FROM drop_pins"), /no such table/)
        }
      }
      await migrateD1(database)
      assert.deepEqual(
        ledger(database),
        [...applied, ...expected].map((migration) => migration.name),
      )
      assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'drops'").get())
      if (applied.length) {
        if (scenario !== "ledger with pins") {
          database.exec("INSERT INTO drop_pins (user_id, drop_id, at) VALUES ('reader', 'doc', 42)")
        }
        const lookup = database.prepare(`
        SELECT drops.title, drops.draft_image, drop_pins.at
        FROM drop_pins JOIN drops ON drops.id = drop_pins.drop_id WHERE drop_pins.user_id = ?
      `)
        assert.deepEqual({ ...lookup.get("reader") }, { title: "Existing doc", draft_image: 0, at: 42 })
        assert.equal(lookup.get("former-reader"), undefined)
        database.exec("DELETE FROM user WHERE id = 'reader'")
        assert.equal(lookup.get("reader"), undefined)
        assert.ok(database.prepare("SELECT 1 FROM drops WHERE id = 'doc'").get())
      }
      await migrateD1(database)
      assert.equal(ledger(database).length, entries.length)
    } finally {
      database.close()
    }
  },
)

test("a database Drizzle Kit 0.x migrated to any point upgrades its ledger and runs only the rest", async () => {
  const directory = new URL("../../server/databases/default/migrations/", import.meta.url)
  // In folder order, as Drizzle applies them. Rows 0.x wrote carry the hash of the SQL file and its journal time, in
  // milliseconds within the folder's second, and no name.
  const folders = dropMigrations().sort((a, b) => (a.tag < b.tag ? -1 : 1))
  const hash = (sql) => createHash("sha256").update(sql).digest("hex")
  const journal = JSON.parse(readFileSync(new URL("./fixtures/legacy-journal.json", import.meta.url), "utf8")).entries
  const legacy = folders.flatMap((migration) => {
    const entry = journal.find((item) => migration.tag.endsWith(`_${item.tag}`))
    return entry ? [{ ...migration, when: entry.when }] : []
  })
  for (let applied = 0; applied <= legacy.length; applied++) {
    const database = new DatabaseSync(":memory:")
    try {
      database.exec("PRAGMA foreign_keys = ON")
      database.exec(
        "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)",
      )
      legacy.slice(0, applied).forEach((migration) => {
        database.exec(migration.sql.replaceAll("--> statement-breakpoint", ""))
        database
          .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
          .run(hash(migration.sql), migration.when)
      })
      // This shipped variant survives timestamp-based upgrades even though its SQL was later replaced with SELECT 1.
      if (applied === legacy.length) {
        const historical = readFileSync(new URL("./fixtures/0004_comment_suggestions.sql", import.meta.url), "utf8")
        assert.equal(hash(historical), "3e6aa3ac60516bdd27edd10c4de906ced19bdbb289c2a2c247a8e7d35a5be083")
        database
          .prepare("UPDATE __drizzle_migrations SET hash = ? WHERE created_at = ?")
          .run(hash(historical), 1793445000000)
        adoptSqliteLedger(database)
        adoptSqliteLedger(database)
      }
      const run = (query, params, rowMode) => {
        const statement = database.prepare(query)
        if (!statement.columns().length) return statement.run(...params)
        statement.setReturnArrays(rowMode !== "object")
        return statement.all(...params)
      }
      const db = drizzle({
        get: async (query, params, rowMode) => run(query, params, rowMode)[0],
        all: async (query, params, rowMode) => run(query, params, rowMode),
        run: async (query, params) => run(query, params),
      })
      await migrate(db, async (statements) => database.exec(`BEGIN; ${statements.join(";\n")}; COMMIT;`), {
        migrationsFolder: fileURLToPath(directory),
      })
      const ledger = database.prepare("SELECT name FROM __drizzle_migrations ORDER BY id").all()
      assert.deepEqual(
        ledger.map((row) => row.name),
        folders.map((migration) => migration.tag),
        `after ${applied} applied`,
      )
      assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'vitehub_comment_threads'").get())
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
      assert.deepEqual(database.prepare("SELECT id, draft_image FROM drops LIMIT 1").all(), [])
    } finally {
      database.close()
    }
  }
})

test("the latest Drizzle snapshot includes all migrated columns of its registered tables", () => {
  const directory = new URL("../../server/databases/default/migrations/", import.meta.url)
  const latest = dropMigrations()
    .map((migration) => migration.tag)
    .sort()
    .at(-1)
  const snapshot = JSON.parse(readFileSync(new URL(`${latest}/snapshot.json`, directory), "utf8"))
  const database = new DatabaseSync(":memory:")
  try {
    for (const migration of dropMigrations()) database.exec(migration.sql)
    const tables = snapshot.ddl.filter((entity) => entity.entityType === "tables")
    for (const table of tables) {
      const columns = database.prepare("SELECT name FROM pragma_table_info(?) ORDER BY name").all(table.name)
      assert.deepEqual(
        columns.map((column) => column.name),
        snapshot.ddl
          .filter((entity) => entity.entityType === "columns" && entity.table === table.name)
          .map((column) => column.name)
          .sort(),
        table.name,
      )
    }
  } finally {
    database.close()
  }
})

test("a D1 that recorded every earlier migration gets Send's tables, and a member's sends are found by them", async () => {
  const database = new DatabaseSync(":memory:")
  const all = dropMigrations()
  const send = all.find((migration) => migration.name === "0017_comment_sends.sql")
  const liveKey = all.find((migration) => migration.name === "0020_comment_sends_live_key.sql")
  assert.ok(send, "0017_comment_sends is a migration")
  assert.ok(liveKey, "0020_comment_sends_live_key is a migration")
  try {
    // Production's D1 before this change: every other migration applied and in Wrangler's ledger, except the later one
    // that indexes Send's tables.
    database.exec(
      "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
    )
    for (const migration of all.filter((item) => item !== send && item !== liveKey)) {
      database.exec(migration.sql.replaceAll("--> statement-breakpoint", ""))
      database.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(migration.name)
    }
    const before = ledger(database)
    await migrateD1(database)
    assert.deepEqual(ledger(database), [...before, "0017_comment_sends.sql", "0020_comment_sends_live_key.sql"])
    // The columns ViteHub reads and writes: a send's endpoint and agent thread, a code's thread, and who owns or
    // disabled an endpoint.
    const columns = (table) =>
      database
        .prepare("SELECT name FROM pragma_table_info(?)")
        .all(table)
        .map((row) => row.name)
    for (const [table, names] of [
      ["drops", ["session_publisher_id"]],
      ["vitehub_comment_sends", ["endpoint", "thread"]],
      ["vitehub_webhook_pairings", ["address"]],
      ["vitehub_webhook_endpoints", ["owner_name", "owner_email", "disabled_by", "address"]],
    ])
      for (const name of names) assert.ok(columns(table).includes(name), `${table}.${name}`)

    const insert = database.prepare(
      "INSERT INTO vitehub_comment_sends (id, member, subject_kind, subject_id, page, threads, key, state, sender, created_at, updated_at) VALUES (?, ?, 'drop', 'd1', '/d/d1', '[]', ?, ?, '{}', ?, ?)",
    )
    insert.run("send_a", "ana", "k", "sent", 1, 1)
    insert.run("send_b", "ana", "k2", "done", 2, 2)
    insert.run("send_c", "bob", "k3", "sent", 3, 3)
    // One send per key is live; a failed one leaves its key free for the retry.
    assert.throws(() => insert.run("send_d", "ana", "k", "working", 4, 4), /UNIQUE/)
    insert.run("send_e", "ana", "k", "failed", 5, 5)
    insert.run("send_f", "ana", "k", "failed", 6, 6)
    // Webhooks keeps one endpoint per member and address, and the pairing codes beside them.
    const endpoint = database.prepare(
      "INSERT INTO vitehub_webhook_endpoints (id, owner, address, name, kind, created_at, updated_at) VALUES (?, 'ana', ?, 'T3 Code thread', 'url', 1, 1)",
    )
    endpoint.run("e1", "")
    endpoint.run("e2", "t3-thread://v2/env/thread-a")
    assert.throws(() => endpoint.run("e3", "t3-thread://v2/env/thread-a"))
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'vitehub_webhook_pairings'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'vitehub_webhook_deliveries'").get())
    await migrateD1(database)
    assert.deepEqual(ledger(database), [...before, "0017_comment_sends.sql", "0020_comment_sends_live_key.sql"])
  } finally {
    database.close()
  }
})

test("sends that an older release made twice yield to one live send before the live key index", async () => {
  const database = new DatabaseSync(":memory:")
  const all = dropMigrations()
  const liveKey = all.find((migration) => migration.name === "0020_comment_sends_live_key.sql")
  assert.ok(liveKey, "0020_comment_sends_live_key is a migration")
  try {
    database.exec(
      "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
    )
    for (const migration of all.filter((item) => item !== liveKey)) {
      database.exec(migration.sql.replaceAll("--> statement-breakpoint", ""))
      database.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(migration.name)
    }
    // Two tabs pressed Send on the same comments before either send was stored.
    const insert = database.prepare(
      "INSERT INTO vitehub_comment_sends (id, member, subject_kind, subject_id, page, threads, key, state, sender, created_at, updated_at) VALUES (?, 'ana', 'drop', 'd1', '/d/d1', '[]', ?, ?, '{}', ?, ?)",
    )
    insert.run("a_pending", "k", "pending", 1, 1)
    insert.run("a_done", "k", "done", 3, 3)
    insert.run("a_sent", "k", "sent", 2, 2)
    insert.run("b_first", "k2", "sent", 1, 1)
    insert.run("b_second", "k2", "sent", 2, 2)
    insert.run("b_failed", "k2", "failed", 0, 0)
    insert.run("c_only", "k3", "working", 1, 1)
    await migrateD1(database)
    const states = Object.fromEntries(
      database
        .prepare("SELECT id, state FROM vitehub_comment_sends ORDER BY id")
        .all()
        .map((row) => [row.id, row.state]),
    )
    assert.deepEqual(states, {
      a_done: "done",
      a_pending: "failed",
      a_sent: "failed",
      b_failed: "failed",
      b_first: "sent",
      b_second: "failed",
      c_only: "working",
    })
    assert.match(
      database.prepare("SELECT error FROM vitehub_comment_sends WHERE id = 'b_second'").get().error,
      /sent twice/,
    )
    assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'vitehub_comment_sends_live_key'").get())
  } finally {
    database.close()
  }
})
