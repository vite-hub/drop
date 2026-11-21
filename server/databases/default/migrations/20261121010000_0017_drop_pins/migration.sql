CREATE TABLE `drop_pins` (
	`user_id` text NOT NULL,
	`drop_id` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT `drop_pins_pk` PRIMARY KEY(`user_id`, `drop_id`),
	CONSTRAINT `fk_drop_pins_drop_id_drops_id_fk` FOREIGN KEY (`drop_id`) REFERENCES `drops`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `drop_pins_drop_idx` ON `drop_pins` (`drop_id`);