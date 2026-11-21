PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_skill_settings` (
	`name` text PRIMARY KEY,
	`enabled` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
INSERT INTO `__new_skill_settings`(`name`, `enabled`, `updated_at`, `updated_by`) SELECT `name`, `enabled`, `updated_at`, `updated_by` FROM `skill_settings`;--> statement-breakpoint
DROP TABLE `skill_settings`;--> statement-breakpoint
ALTER TABLE `__new_skill_settings` RENAME TO `skill_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
