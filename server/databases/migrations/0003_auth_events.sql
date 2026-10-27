-- ViteHub's event store owns this table. Keep its DDL in step with createDatabaseAuthEventStore.
CREATE TABLE IF NOT EXISTS vitehub_auth_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  time TEXT NOT NULL,
  actor TEXT NOT NULL,
  user_id TEXT,
  method TEXT,
  payload TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS vitehub_auth_events_time ON vitehub_auth_events (time, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS vitehub_auth_events_type ON vitehub_auth_events (type, time, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS vitehub_auth_events_user ON vitehub_auth_events (user_id, time, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS vitehub_auth_events_actor ON vitehub_auth_events (actor, time, id);
