-- A membership goes with its account: member.user_id now references user(id) and cascades. Deleting an account through
-- Better Auth takes it off its teams first (server/utils/teams.ts leaveTeams), so Stripe bills one seat less; the
-- cascade catches any other delete. Memberships whose account is already gone are not copied. It needs no
-- `PRAGMA foreign_keys=OFF`: no table references member.
CREATE TABLE `__new_member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_member`("id", "organization_id", "user_id", "role", "created_at") SELECT "id", "organization_id", "user_id", "role", "created_at" FROM `member` WHERE "user_id" IN (SELECT "id" FROM `user`);--> statement-breakpoint
DROP TABLE `member`;--> statement-breakpoint
ALTER TABLE `__new_member` RENAME TO `member`;--> statement-breakpoint
CREATE INDEX `member_organization_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_user_organization_idx` ON `member` (`user_id`,`organization_id`);
