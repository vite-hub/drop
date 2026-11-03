CREATE TABLE `review_submissions` (
	`scope` text NOT NULL,
	`request_id` text NOT NULL,
	`thread_id` text NOT NULL,
	PRIMARY KEY(`scope`, `request_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `vitehub_comment_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_submissions_thread_idx` ON `review_submissions` (`thread_id`);
--> statement-breakpoint
-- Keep request ids already saved by earlier review clients, without removing any existing comments.
INSERT OR IGNORE INTO `review_submissions` (`scope`, `request_id`, `thread_id`)
SELECT `scope`, json_extract(`metadata`, '$.requestId'), `id`
FROM `vitehub_comment_threads`
WHERE substr(`scope`, 1, 5) = 'site:' AND json_type(`metadata`, '$.requestId') = 'text'
ORDER BY `created_at`, `id`;
--> statement-breakpoint
-- Comments inserts the thread and its first comment in one batch. Claiming the request here makes that batch
-- fail atomically when another POST has already saved it, including writes still in flight during a retry's GET.
CREATE TRIGGER `review_submission_claim` AFTER INSERT ON `vitehub_comment_threads`
WHEN substr(NEW.`scope`, 1, 5) = 'site:' AND json_type(NEW.`metadata`, '$.requestId') = 'text'
BEGIN
	INSERT INTO `review_submissions` (`scope`, `request_id`, `thread_id`)
	VALUES (NEW.`scope`, json_extract(NEW.`metadata`, '$.requestId'), NEW.`id`);
END;
