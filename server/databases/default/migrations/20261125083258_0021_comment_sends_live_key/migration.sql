ALTER TABLE `vitehub_webhook_deliveries` ADD `owner` text;--> statement-breakpoint
CREATE UNIQUE INDEX `vitehub_comment_sends_live_key` ON `vitehub_comment_sends` (`key`) WHERE `state` <> 'failed';--> statement-breakpoint
CREATE INDEX `vitehub_webhook_deliveries_owner` ON `vitehub_webhook_deliveries` (`owner`,`created_at`,`id`) WHERE owner IS NOT NULL;--> statement-breakpoint
CREATE INDEX `vitehub_webhook_endpoints_created` ON `vitehub_webhook_endpoints` (`created_at`,`id`);
