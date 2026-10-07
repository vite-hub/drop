CREATE UNIQUE INDEX `drops_supersedes_unique` ON `drops` (`supersedes_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `comments_drop_n_unique` ON `comments` (`drop_id`,`n`);
--> statement-breakpoint
CREATE TABLE `blob_cleanup` (
	`id` text PRIMARY KEY NOT NULL,
	`blob_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blob_cleanup_key_unique` ON `blob_cleanup` (`blob_key`);
--> statement-breakpoint
ALTER TABLE `drops` ADD `publish_token` text;
