ALTER TABLE user ADD COLUMN share_approved_at integer;
--> statement-breakpoint
ALTER TABLE user ADD COLUMN github_created_at integer;
--> statement-breakpoint
ALTER TABLE drops ADD COLUMN share_review text CHECK (share_review IS NULL OR share_review IN ('pending', 'rejected'));
--> statement-breakpoint
ALTER TABLE drops ADD COLUMN quarantined_at integer;
--> statement-breakpoint
CREATE TABLE abuse_reports (
  id text PRIMARY KEY NOT NULL,
  drop_id text,
  owner_id text,
  target text NOT NULL,
  reason text NOT NULL,
  details text NOT NULL,
  email text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'quarantined', 'banned')),
  created_at integer NOT NULL,
  resolved_at integer,
  resolved_by text
);
--> statement-breakpoint
CREATE INDEX abuse_reports_status_idx ON abuse_reports (status, created_at);
--> statement-breakpoint
CREATE INDEX abuse_reports_target_idx ON abuse_reports (target);
