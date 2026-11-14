CREATE TABLE `suggestion_acceptances` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`drop_id` text NOT NULL,
	`version` integer NOT NULL,
	FOREIGN KEY (`drop_id`) REFERENCES `drops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `suggestion_acceptances_drop` ON `suggestion_acceptances` (`drop_id`);