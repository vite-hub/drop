CREATE TABLE `profile` (
	`user_id` text PRIMARY KEY NOT NULL,
	`plan` text,
	`github_created_at` integer,
	CONSTRAINT `fk_profile_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `profile` (`user_id`, `plan`, `github_created_at`) SELECT `id`, `plan`, `github_created_at` FROM `user`;
