CREATE TABLE IF NOT EXISTS `comment_cleanup` (
	`drop_id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`shot` integer NOT NULL,
	`created_at` integer NOT NULL
);
