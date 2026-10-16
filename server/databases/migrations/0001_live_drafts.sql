CREATE TABLE `workspace_history_metadata` (
	`workspace` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`workspace`, `key`)
);
--> statement-breakpoint
CREATE TABLE `workspace_history_objects` (
	`workspace` text NOT NULL,
	`digest` text NOT NULL,
	`size` integer NOT NULL,
	PRIMARY KEY(`workspace`, `digest`)
);
--> statement-breakpoint
CREATE TABLE `workspace_history_refs` (
	`workspace` text PRIMARY KEY NOT NULL,
	`head` text,
	`sequence` integer DEFAULT 0 NOT NULL,
	`deleted` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_history_revisions` (
	`workspace` text NOT NULL,
	`id` text NOT NULL,
	`parent_id` text,
	`sequence` integer NOT NULL,
	`created_at` text NOT NULL,
	`message` text,
	`metadata` text,
	`files` integer NOT NULL,
	`bytes` integer NOT NULL,
	`entries` text NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`workspace`, `id`)
);
--> statement-breakpoint
CREATE INDEX `workspace_history_timeline` ON `workspace_history_revisions` (`workspace`,`published`,`sequence`);
