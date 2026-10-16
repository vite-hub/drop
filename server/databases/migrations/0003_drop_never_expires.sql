-- Applied after the Worker that reads `lifetime` is live: the previous one still reads these columns.
UPDATE `drops` SET `lifetime` = 'keep' WHERE `never_expires` = 1 AND `lifetime` != 'keep';--> statement-breakpoint
ALTER TABLE `drops` DROP COLUMN `never_expires`;--> statement-breakpoint
ALTER TABLE `drops` DROP COLUMN `never_expires_request`;
