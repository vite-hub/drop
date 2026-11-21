CREATE TABLE `drop_runtime_errors` (
	`drop_id` text PRIMARY KEY,
	`version` integer NOT NULL,
	`errors` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_drop_runtime_errors_drop_id_drops_id_fk` FOREIGN KEY (`drop_id`) REFERENCES `drops`(`id`) ON DELETE CASCADE
);
