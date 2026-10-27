CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`drop_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`n` integer NOT NULL,
	`kind` text NOT NULL,
	`selector` text NOT NULL,
	`ox` integer DEFAULT 0 NOT NULL,
	`oy` integer DEFAULT 0 NOT NULL,
	`quote` text,
	`label` text,
	`page` text,
	`body` text NOT NULL,
	`author_id` text,
	`author_name` text NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`ow` integer DEFAULT 0 NOT NULL,
	`oh` integer DEFAULT 0 NOT NULL,
	`element_x` integer,
	`element_y` integer,
	FOREIGN KEY (`drop_id`) REFERENCES `drops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `drop_files` (
	`drop_id` text NOT NULL,
	`path` text NOT NULL,
	`blob_key` text NOT NULL,
	`size` integer NOT NULL,
	FOREIGN KEY (`drop_id`) REFERENCES `drops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drop_files_path_idx` ON `drop_files` (`drop_id`,`path`);
--> statement-breakpoint
CREATE TABLE `drops` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`filename` text NOT NULL,
	`blob_key` text,
	`content_type` text,
	`size` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`share` text DEFAULT 'private' NOT NULL,
	`public_until` integer,
	`team_folder` integer DEFAULT false NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`publish_token` text,
	`share_review` text CHECK (share_review IS NULL OR share_review IN ('pending', 'rejected')),
	`quarantined_at` integer,
	`last_accessed_at` integer,
	`lifetime` text DEFAULT 'review' NOT NULL,
	`keep_reason` text,
	`note` text,
	`trashed_at` integer,
	`trash_reason` text,
	`parent_id` text,
	`slug` text,
	`site_url` text,
	`team_id` text,
	`agent` text,
	`resources` text
);
--> statement-breakpoint
-- The versions of a doc before its latest, which is its `drops` row (server/utils/drops/write.ts).
CREATE TABLE `drop_versions` (
	`drop_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`filename` text NOT NULL,
	`blob_key` text,
	`content_type` text,
	`size` integer DEFAULT 0 NOT NULL,
	`note` text,
	`actor_kind` text NOT NULL,
	`actor_name` text NOT NULL,
	`agent` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`drop_id`, `version`),
	FOREIGN KEY (`drop_id`) REFERENCES `drops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drop_versions_blob_key_idx` ON `drop_versions` (`blob_key`);
--> statement-breakpoint
CREATE INDEX `drops_owner_idx` ON `drops` (`owner_id`,`updated_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `drops_blob_key_idx` ON `drops` (`blob_key`);
--> statement-breakpoint
CREATE INDEX `drops_expiry_idx` ON `drops` (`lifetime`,`last_accessed_at`);
--> statement-breakpoint
CREATE INDEX `drops_trash_idx` ON `drops` (`trashed_at`);
--> statement-breakpoint
CREATE INDEX `drops_parent_idx` ON `drops` (`parent_id`);
--> statement-breakpoint
CREATE INDEX `drops_share_idx` ON `drops` (`share`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`impersonated_by` text,
	`active_organization_id` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);
--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text,
	`banned` integer DEFAULT false,
	`ban_reason` text,
	`ban_expires` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`plan` text CHECK (`plan` IN ('free', 'pro', 'unlimited')),
	`share_approved_at` integer,
	`github_created_at` integer,
	`stripe_customer_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);
--> statement-breakpoint
CREATE UNIQUE INDEX `comments_drop_n_unique` ON `comments` (`drop_id`,`n`);
--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`team_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`inviter_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_organization_idx` ON `invitation` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);
--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_organization_idx` ON `member` (`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_user_organization_idx` ON `member` (`user_id`,`organization_id`);
--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`metadata` text,
	`stripe_customer_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_idx` ON `organization` (`slug`);
--> statement-breakpoint
CREATE TABLE `subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`plan` text NOT NULL,
	`reference_id` text NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`status` text DEFAULT 'incomplete',
	`period_start` integer,
	`period_end` integer,
	`trial_start` integer,
	`trial_end` integer,
	`cancel_at_period_end` integer DEFAULT false,
	`cancel_at` integer,
	`canceled_at` integer,
	`ended_at` integer,
	`seats` integer,
	`billing_interval` text,
	`stripe_schedule_id` text
);
--> statement-breakpoint
CREATE INDEX `subscription_reference_idx` ON `subscription` (`reference_id`);
--> statement-breakpoint
CREATE TABLE `blob_cleanup` (
	`id` text PRIMARY KEY NOT NULL,
	`blob_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blob_cleanup_blob_key_unique` ON `blob_cleanup` (`blob_key`);
--> statement-breakpoint
CREATE TABLE `jwks` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`alg` text,
	`crv` text
);
--> statement-breakpoint
CREATE TABLE `oauth_client` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`client_secret` text,
	`client_discovery_id` text,
	`disabled` integer,
	`skip_consent` integer,
	`enable_end_session` integer,
	`subject_type` text,
	`scopes` text,
	`client_credentials_scopes` text,
	`user_id` text,
	`created_at` integer,
	`updated_at` integer,
	`name` text,
	`uri` text,
	`icon` text,
	`contacts` text,
	`tos` text,
	`policy` text,
	`software_id` text,
	`software_version` text,
	`software_statement` text,
	`redirect_uris` text NOT NULL,
	`post_logout_redirect_uris` text,
	`backchannel_logout_uri` text,
	`backchannel_logout_session_required` integer,
	`token_endpoint_auth_method` text,
	`application_type` text,
	`jwks` text,
	`jwks_uri` text,
	`grant_types` text,
	`response_types` text,
	`require_pkce` integer,
	`dpop_bound_access_tokens` integer,
	`reference_id` text,
	`metadata` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_client_client_id_unique` ON `oauth_client` (`client_id`);
--> statement-breakpoint
CREATE INDEX `oauth_client_user_id_idx` ON `oauth_client` (`user_id`);
--> statement-breakpoint
CREATE TABLE `oauth_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`name` text NOT NULL,
	`access_token_ttl` integer,
	`refresh_token_ttl` integer,
	`signing_algorithm` text,
	`signing_key_id` text,
	`allowed_scopes` text,
	`custom_claims` text,
	`dpop_bound_access_tokens_required` integer,
	`disabled` integer,
	`created_at` integer,
	`updated_at` integer,
	`policy_version` integer,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_resource_identifier_unique` ON `oauth_resource` (`identifier`);
--> statement-breakpoint
CREATE TABLE `oauth_client_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`metadata` text,
	`created_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `oauth_resource`(`identifier`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_client_resource_client_id_idx` ON `oauth_client_resource` (`client_id`);
--> statement-breakpoint
CREATE INDEX `oauth_client_resource_resource_id_idx` ON `oauth_client_resource` (`resource_id`);
--> statement-breakpoint
CREATE TABLE `oauth_refresh_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text NOT NULL,
	`reference_id` text,
	`authorization_code_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`expires_at` integer,
	`created_at` integer,
	`revoked` integer,
	`rotated_at` integer,
	`rotation_replay_response` text,
	`rotation_replay_expires_at` integer,
	`auth_time` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_refresh_token_token_unique` ON `oauth_refresh_token` (`token`);
--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_client_id_idx` ON `oauth_refresh_token` (`client_id`);
--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_session_id_idx` ON `oauth_refresh_token` (`session_id`);
--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_user_id_idx` ON `oauth_refresh_token` (`user_id`);
--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_authorization_code_id_idx` ON `oauth_refresh_token` (`authorization_code_id`);
--> statement-breakpoint
CREATE TABLE `oauth_access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text,
	`reference_id` text,
	`authorization_code_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`refresh_id` text,
	`expires_at` integer,
	`created_at` integer,
	`revoked` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`refresh_id`) REFERENCES `oauth_refresh_token`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_access_token_token_unique` ON `oauth_access_token` (`token`);
--> statement-breakpoint
CREATE INDEX `oauth_access_token_client_id_idx` ON `oauth_access_token` (`client_id`);
--> statement-breakpoint
CREATE INDEX `oauth_access_token_session_id_idx` ON `oauth_access_token` (`session_id`);
--> statement-breakpoint
CREATE INDEX `oauth_access_token_user_id_idx` ON `oauth_access_token` (`user_id`);
--> statement-breakpoint
CREATE INDEX `oauth_access_token_authorization_code_id_idx` ON `oauth_access_token` (`authorization_code_id`);
--> statement-breakpoint
CREATE INDEX `oauth_access_token_refresh_id_idx` ON `oauth_access_token` (`refresh_id`);
--> statement-breakpoint
CREATE TABLE `oauth_consent` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text,
	`reference_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`scopes` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_consent_client_id_idx` ON `oauth_consent` (`client_id`);
--> statement-breakpoint
CREATE INDEX `oauth_consent_user_id_idx` ON `oauth_consent` (`user_id`);
--> statement-breakpoint
CREATE TABLE `oauth_client_assertion` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `code_images` (
  `blob_key` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL,
  `size` integer NOT NULL,
  `expires_at` integer NOT NULL,
  CONSTRAINT `code_images_size` CHECK (`size` >= 0)
);
--> statement-breakpoint
CREATE INDEX `code_images_owner_idx` ON `code_images` (`owner_id`);
--> statement-breakpoint
CREATE INDEX `code_images_expires_idx` ON `code_images` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `quota_reservations` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL,
  `month` text NOT NULL,
  `drops` integer NOT NULL CHECK (`drops` >= 0),
  `bytes` integer NOT NULL CHECK (`bytes` >= 0),
  `writes` integer NOT NULL CHECK (`writes` >= 0),
  `target_id` text,
  `committed` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quota_owner_month_idx` ON `quota_reservations` (`owner_id`, `month`);
--> statement-breakpoint
CREATE UNIQUE INDEX `quota_pending_target_idx` ON `quota_reservations` (`target_id`) WHERE `committed` = 0;
--> statement-breakpoint
CREATE INDEX `quota_owner_pending_idx` ON `quota_reservations` (`owner_id`, `committed`);
--> statement-breakpoint
CREATE TABLE abuse_reports (
  id text PRIMARY KEY NOT NULL,
  drop_id text,
  owner_id text,
  target text NOT NULL,
  reason text NOT NULL,
  details text NOT NULL,
  email text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'quarantined', 'banned')),
  created_at integer NOT NULL,
  resolved_at integer,
  resolved_by text
);
--> statement-breakpoint
CREATE INDEX abuse_reports_status_idx ON abuse_reports (status, created_at);
--> statement-breakpoint
CREATE INDEX abuse_reports_target_idx ON abuse_reports (target);
--> statement-breakpoint
CREATE TABLE `skill_settings` (
	`name` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `drop_visits` (
	`user_id` text NOT NULL,
	`drop_id` text NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `drop_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`drop_id`) REFERENCES `drops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `drop_visits_drop_idx` ON `drop_visits` (`drop_id`);
--> statement-breakpoint
-- Search reads a text doc's words from here, latest versions only (server/utils/search.ts).
CREATE TABLE `drop_texts` (
	`drop_id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`drop_id`) REFERENCES `drops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- A comment's thread: replies are words only; the comment keeps the anchor, number, and resolved state.
CREATE TABLE `comment_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`body` text NOT NULL,
	`author_id` text,
	`author_name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comment_replies_comment_idx` ON `comment_replies` (`comment_id`,`created_at`);
--> statement-breakpoint
-- Images in a comment or a reply: each is an image drop under the commented drop (server/utils/comment-images.ts).
CREATE TABLE `comment_attachments` (
	`drop_id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`reply_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`drop_id`) REFERENCES `drops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reply_id`) REFERENCES `comment_replies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comment_attachments_comment_idx` ON `comment_attachments` (`comment_id`,`created_at`);
--> statement-breakpoint
-- A drop's views for its Details (server/utils/views.ts): a new viewer of the day counts one view.
CREATE TABLE `drop_views` (
	`drop_id` text NOT NULL,
	`day` integer NOT NULL,
	`viewer` text NOT NULL,
	`views` integer NOT NULL,
	PRIMARY KEY(`drop_id`, `day`, `viewer`),
	FOREIGN KEY (`drop_id`) REFERENCES `drops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `drop_viewers` (
	`drop_id` text NOT NULL,
	`day` integer NOT NULL,
	`id` text NOT NULL,
	`viewer` text NOT NULL,
	PRIMARY KEY(`drop_id`, `day`, `id`),
	FOREIGN KEY (`drop_id`) REFERENCES `drops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `drop_viewers_day_idx` ON `drop_viewers` (`day`);
--> statement-breakpoint
CREATE TRIGGER `drop_viewers_count` AFTER INSERT ON `drop_viewers` BEGIN
  INSERT OR IGNORE INTO `drop_views` (`drop_id`, `day`, `viewer`, `views`) VALUES (NEW.drop_id, NEW.day, NEW.viewer, 0);
  UPDATE `drop_views` SET `views` = `views` + 1 WHERE `drop_id` = NEW.drop_id AND `day` = NEW.day AND `viewer` = NEW.viewer;
END;
