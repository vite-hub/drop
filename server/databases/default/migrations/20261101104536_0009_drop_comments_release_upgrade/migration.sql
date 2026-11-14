-- The released parent has a newer ledger timestamp than the child previews. Reapply the comment move after it so
-- parent databases receive the child schema too. Preview databases keep their attachments, cleanup work and receipts.
-- Drop's comments move to ViteHub Comments (vitehub_comment_threads and vitehub_comments, 0003). The old comments and
-- replies go. comment_attachments loses its foreign keys to them, since its ids now name ViteHub comments. Its rows
-- stay: they keep the images of the old comments out of their drops' embedded files, and the images go with their drop.
-- The rebuild comes first: dropping `comments` while the old comment_attachments exists would cascade into it. It needs
-- no `PRAGMA foreign_keys=OFF`: no table references comment_attachments.
-- Earlier child previews already removed the old tables. Replaying after the parent migrations preserves attachments.
CREATE TABLE `__new_comment_attachments` (
	`drop_id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`reply_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`drop_id`) REFERENCES `drops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_comment_attachments`("drop_id", "comment_id", "reply_id", "created_at") SELECT "drop_id", "comment_id", "reply_id", "created_at" FROM `comment_attachments`;--> statement-breakpoint
DROP TABLE `comment_attachments`;--> statement-breakpoint
ALTER TABLE `__new_comment_attachments` RENAME TO `comment_attachments`;--> statement-breakpoint
CREATE INDEX `comment_attachments_comment_idx` ON `comment_attachments` (`comment_id`,`created_at`);--> statement-breakpoint
DROP TABLE IF EXISTS `comment_replies`;--> statement-breakpoint
DROP TABLE IF EXISTS `comments`;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `comment_cleanup` (
	`drop_id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`shot` integer NOT NULL,
	`created_at` integer NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `suggestion_acceptances` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`drop_id` text NOT NULL,
	`version` integer NOT NULL,
	`undone_version` integer,
	FOREIGN KEY (`drop_id`) REFERENCES `drops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `suggestion_acceptances_drop` ON `suggestion_acceptances` (`drop_id`);
