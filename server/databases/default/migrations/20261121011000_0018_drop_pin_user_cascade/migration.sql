CREATE TABLE `__new_drop_pins` (
	`user_id` text NOT NULL,
	`drop_id` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT `drop_pins_pk` PRIMARY KEY(`user_id`, `drop_id`),
	CONSTRAINT `fk_drop_pins_drop_id_drops_id_fk` FOREIGN KEY (`drop_id`) REFERENCES `drops`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_drop_pins_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_drop_pins` (`user_id`, `drop_id`, `at`)
SELECT `drop_pins`.`user_id`, `drop_pins`.`drop_id`, `drop_pins`.`at`
FROM `drop_pins` INNER JOIN `user` ON `user`.`id` = `drop_pins`.`user_id`;
--> statement-breakpoint
DROP TABLE `drop_pins`;
--> statement-breakpoint
ALTER TABLE `__new_drop_pins` RENAME TO `drop_pins`;
--> statement-breakpoint
CREATE INDEX `drop_pins_drop_idx` ON `drop_pins` (`drop_id`);
