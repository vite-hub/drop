CREATE TABLE `ui_usage` (
	`day` text NOT NULL,
	`release` text NOT NULL,
	`kind` text NOT NULL,
	`mode` text NOT NULL,
	`control` text NOT NULL,
	`via` text NOT NULL,
	`count` integer NOT NULL,
	CONSTRAINT `ui_usage_pk` PRIMARY KEY(`day`, `release`, `kind`, `mode`, `control`, `via`)
);
