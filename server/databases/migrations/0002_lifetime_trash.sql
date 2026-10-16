DROP INDEX `drops_expiry_idx`;--> statement-breakpoint
ALTER TABLE `drops` ADD `lifetime` text DEFAULT 'review' NOT NULL;--> statement-breakpoint
ALTER TABLE `drops` ADD `keep_reason` text;--> statement-breakpoint
ALTER TABLE `drops` ADD `note` text;--> statement-breakpoint
ALTER TABLE `drops` ADD `trashed_at` integer;--> statement-breakpoint
ALTER TABLE `drops` ADD `trash_reason` text;--> statement-breakpoint
ALTER TABLE `drops` ADD `parent_id` text;--> statement-breakpoint
CREATE INDEX `drops_trash_idx` ON `drops` (`trashed_at`);--> statement-breakpoint
CREATE INDEX `drops_parent_idx` ON `drops` (`parent_id`);--> statement-breakpoint
CREATE INDEX `drops_expiry_idx` ON `drops` (`lifetime`,`last_accessed_at`);--> statement-breakpoint
UPDATE `drops` SET `lifetime` = 'keep' WHERE `never_expires` = 1;--> statement-breakpoint
ALTER TABLE `comments` ADD `ow` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `comments` ADD `oh` integer DEFAULT 0 NOT NULL;