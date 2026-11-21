ALTER TABLE `drops` ADD `session_publisher_id` text;
--> statement-breakpoint
CREATE TABLE `vitehub_comment_sends` (
	`id` text PRIMARY KEY,
	`member` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`page` text NOT NULL,
	`threads` text NOT NULL,
	`key` text NOT NULL,
	`state` text NOT NULL,
	`delivery` text,
	`endpoint` text,
	`thread` text,
	`error` text,
	`sender` text NOT NULL,
	`token_hash` text,
	`token_expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vitehub_webhook_deliveries` (
	`id` text PRIMARY KEY,
	`webhook` text NOT NULL,
	`key` text,
	`event` text NOT NULL,
	`body` text NOT NULL,
	`revision` integer NOT NULL,
	`count` integer NOT NULL,
	`state` text NOT NULL,
	`attempts` integer NOT NULL,
	`last_status` integer,
	`last_error` text,
	`due_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE TABLE `vitehub_webhook_endpoints` (
	`id` text PRIMARY KEY,
	`owner` text NOT NULL,
	`owner_name` text,
	`owner_email` text,
	`name` text NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`agent` text,
	`host` text,
	`sealed` text,
	`disabled_at` integer,
	`disabled_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vitehub_webhook_pairings` (
	`id` text PRIMARY KEY,
	`owner` text NOT NULL,
	`state` text NOT NULL,
	`agent` text,
	`host` text,
	`address` text,
	`sealed` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vitehub_comment_sends_member` ON `vitehub_comment_sends` (`member`,`created_at`);
--> statement-breakpoint
CREATE INDEX `vitehub_comment_sends_subject` ON `vitehub_comment_sends` (`subject_kind`,`subject_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `vitehub_webhook_deliveries_pending` ON `vitehub_webhook_deliveries` (`webhook`,`key`) WHERE state = 'pending';
--> statement-breakpoint
CREATE INDEX `vitehub_webhook_deliveries_webhook` ON `vitehub_webhook_deliveries` (`webhook`,`created_at`);
--> statement-breakpoint
CREATE INDEX `vitehub_webhook_deliveries_state` ON `vitehub_webhook_deliveries` (`state`,`due_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `vitehub_webhook_endpoints_owner` ON `vitehub_webhook_endpoints` (`owner`,`address`);
--> statement-breakpoint
CREATE INDEX `vitehub_webhook_pairings_owner` ON `vitehub_webhook_pairings` (`owner`);
