CREATE TABLE `drop_visits` (
	`user_id` text NOT NULL,
	`drop_id` text NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `drop_id`)
);
--> statement-breakpoint
CREATE INDEX `drop_visits_drop_idx` ON `drop_visits` (`drop_id`);--> statement-breakpoint
CREATE INDEX `drops_visibility_idx` ON `drops` (`visibility`,`updated_at`);--> statement-breakpoint
-- "Shared with me" follows a drop to its newest version and forgets it with the last one.
CREATE TRIGGER `drop_visits_new_version` AFTER INSERT ON `drops` WHEN NEW.supersedes_id IS NOT NULL BEGIN
  UPDATE OR REPLACE `drop_visits` SET `drop_id` = NEW.id WHERE `drop_id` = NEW.supersedes_id;
END;
--> statement-breakpoint
CREATE TRIGGER `drop_visits_drop_delete` AFTER DELETE ON `drops` BEGIN
  UPDATE OR REPLACE `drop_visits` SET `drop_id` = OLD.supersedes_id
  WHERE `drop_id` = OLD.id AND EXISTS (SELECT 1 FROM drops d WHERE d.id = OLD.supersedes_id);
  DELETE FROM `drop_visits` WHERE `drop_id` = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER `drop_visits_user_delete` AFTER DELETE ON `user` BEGIN
  DELETE FROM `drop_visits` WHERE `user_id` = OLD.id;
END;
