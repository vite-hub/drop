CREATE TABLE `blob_tombstones` (
  `blob_key` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
INSERT INTO `blob_tombstones` (`blob_key`) SELECT `blob_key` FROM `blob_cleanup`;
--> statement-breakpoint
CREATE TABLE `code_images` (
  `blob_key` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `code_images_expires_idx` ON `code_images` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `workspace_stats` (
  `id` integer PRIMARY KEY NOT NULL,
  `members` integer NOT NULL,
  CONSTRAINT `workspace_stats_singleton` CHECK (`id` = 1)
);
--> statement-breakpoint
INSERT INTO `workspace_stats` (`id`, `members`) SELECT 1, count(*) FROM `user`;
--> statement-breakpoint
CREATE TRIGGER `workspace_members_insert` AFTER INSERT ON `user` BEGIN
  UPDATE `workspace_stats` SET `members` = `members` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `workspace_members_delete` AFTER DELETE ON `user` BEGIN
  UPDATE `workspace_stats` SET `members` = `members` - 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TABLE `drop_heads` (
  `drop_id` text PRIMARY KEY NOT NULL REFERENCES `drops` (`id`) ON DELETE CASCADE,
  `owner_id` text NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `drop_heads_owner_idx` ON `drop_heads` (`owner_id`, `updated_at`);
--> statement-breakpoint
INSERT INTO `drop_heads` (`drop_id`, `owner_id`, `updated_at`)
SELECT d.id, d.owner_id, d.updated_at FROM drops d
WHERE NOT EXISTS (SELECT 1 FROM drops n WHERE n.supersedes_id = d.id AND n.owner_id = d.owner_id);
--> statement-breakpoint
CREATE TRIGGER `drop_heads_insert` AFTER INSERT ON `drops` BEGIN
  INSERT INTO `drop_heads` (`drop_id`, `owner_id`, `updated_at`)
  SELECT NEW.id, NEW.owner_id, NEW.updated_at
  WHERE NOT EXISTS (SELECT 1 FROM drops n WHERE n.supersedes_id = NEW.id AND n.owner_id = NEW.owner_id);
  DELETE FROM `drop_heads` WHERE `drop_id` = NEW.supersedes_id AND `owner_id` = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER `drop_heads_update` AFTER UPDATE OF `updated_at` ON `drops` BEGIN
  UPDATE `drop_heads` SET `updated_at` = NEW.updated_at WHERE `drop_id` = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `drop_heads_delete` AFTER DELETE ON `drops` BEGIN
  DELETE FROM `drop_heads` WHERE `drop_id` = OLD.id;
  INSERT OR IGNORE INTO `drop_heads` (`drop_id`, `owner_id`, `updated_at`)
  SELECT d.id, d.owner_id, d.updated_at FROM drops d
  WHERE d.id = OLD.supersedes_id AND d.owner_id = OLD.owner_id
    AND NOT EXISTS (SELECT 1 FROM drops n WHERE n.supersedes_id = d.id AND n.owner_id = d.owner_id);
END;
