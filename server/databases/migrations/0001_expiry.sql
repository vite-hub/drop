ALTER TABLE `drops` ADD `last_accessed_at` integer;
--> statement-breakpoint
ALTER TABLE `drops` ADD `never_expires` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `drops` ADD `never_expires_request` text;
--> statement-breakpoint
-- Drops that predate expiry get a full window from the day it ships.
UPDATE `drops` SET `last_accessed_at` = CAST(unixepoch('subsec') * 1000 AS integer);
--> statement-breakpoint
CREATE INDEX `drops_expiry_idx` ON `drops` (`never_expires`,`last_accessed_at`);
