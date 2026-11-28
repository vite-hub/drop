ALTER TABLE `drops` ADD `role` text;--> statement-breakpoint
CREATE UNIQUE INDEX `drops_notes_folder_idx` ON `drops` (`owner_id`) WHERE "drops"."role" = 'notes-folder' and "drops"."trashed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `drops_notes_idx` ON `drops` (`parent_id`,`site_url`) WHERE "drops"."role" = 'notes' and "drops"."trashed_at" is null;
