ALTER TABLE `vitehub_webhook_deliveries` ADD `owner` text;--> statement-breakpoint
-- Before the unique index, a send whose comments were sent again (two tabs pressing Send at once) yields to the other: the further along one stands (done, working, sent, then pending), else the earliest. Rows stay, marked failed.
UPDATE `vitehub_comment_sends` SET `state` = 'failed', `error` = 'These comments were sent twice, and the other send stands.', `updated_at` = CAST(strftime('%s', 'now') AS integer) * 1000
WHERE `id` IN (
	SELECT `id` FROM (
		SELECT `id`, ROW_NUMBER() OVER (
			PARTITION BY `key`
			ORDER BY (CASE `state` WHEN 'done' THEN 3 WHEN 'working' THEN 2 WHEN 'sent' THEN 1 ELSE 0 END) DESC, `created_at`, `id`
		) AS `rank`
		FROM `vitehub_comment_sends` WHERE `state` <> 'failed'
	) WHERE `rank` > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `vitehub_comment_sends_live_key` ON `vitehub_comment_sends` (`key`) WHERE `state` <> 'failed';--> statement-breakpoint
CREATE INDEX `vitehub_webhook_deliveries_owner` ON `vitehub_webhook_deliveries` (`owner`,`created_at`,`id`) WHERE owner IS NOT NULL;--> statement-breakpoint
CREATE INDEX `vitehub_webhook_endpoints_created` ON `vitehub_webhook_endpoints` (`created_at`,`id`);
