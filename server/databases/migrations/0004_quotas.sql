ALTER TABLE `user` ADD `plan` text CHECK (`plan` IN ('free', 'pro', 'unlimited'));
--> statement-breakpoint
CREATE TABLE `quota_reservations` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL,
  `month` text NOT NULL,
  `drops` integer NOT NULL CHECK (`drops` >= 0),
  `bytes` integer NOT NULL CHECK (`bytes` >= 0),
  `writes` integer NOT NULL CHECK (`writes` >= 0),
  `target_id` text,
  `committed` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quota_owner_month_idx` ON `quota_reservations` (`owner_id`, `month`);
--> statement-breakpoint
CREATE UNIQUE INDEX `quota_pending_target_idx` ON `quota_reservations` (`target_id`) WHERE `committed` = 0;
--> statement-breakpoint
CREATE INDEX `quota_owner_pending_idx` ON `quota_reservations` (`owner_id`, `committed`);
--> statement-breakpoint
CREATE TABLE `quota_blobs` (
  `blob_key` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL,
  `size` integer NOT NULL CHECK (`size` >= 0),
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quota_blobs_owner_idx` ON `quota_blobs` (`owner_id`);
