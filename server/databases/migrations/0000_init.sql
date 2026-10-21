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
	FOREIGN KEY (`drop_id`) REFERENCES `drops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comments_drop_idx` ON `comments` (`drop_id`,`n`);
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
	`supersedes_id` text,
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
	`link` text,
	`slug` text,
	`site_url` text
);
--> statement-breakpoint
CREATE INDEX `drops_owner_idx` ON `drops` (`owner_id`,`updated_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `drops_blob_key_idx` ON `drops` (`blob_key`);
--> statement-breakpoint
CREATE INDEX `drops_link_idx` ON `drops` (`link`,`version`);
--> statement-breakpoint
CREATE INDEX `drops_supersedes_idx` ON `drops` (`supersedes_id`);
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
	`github_created_at` integer
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
CREATE UNIQUE INDEX `drops_supersedes_unique` ON `drops` (`supersedes_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `comments_drop_n_unique` ON `comments` (`drop_id`,`n`);
--> statement-breakpoint
CREATE TABLE `blob_cleanup` (
	`id` text PRIMARY KEY NOT NULL,
	`blob_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blob_cleanup_key_unique` ON `blob_cleanup` (`blob_key`);
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
INSERT INTO `workspace_stats` (`id`, `members`) VALUES (1, 0);
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
CREATE TABLE `quota_blobs` (
  `blob_key` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL,
  `size` integer NOT NULL CHECK (`size` >= 0),
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quota_blobs_owner_idx` ON `quota_blobs` (`owner_id`);
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
	PRIMARY KEY(`user_id`, `drop_id`)
);
--> statement-breakpoint
CREATE INDEX `drop_visits_drop_idx` ON `drop_visits` (`drop_id`);--> statement-breakpoint
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
-- A drop's views for its Details (server/utils/views.ts): a new viewer of the day counts one view.
CREATE TABLE `drop_views` (
	`link` text NOT NULL,
	`day` integer NOT NULL,
	`viewer` text NOT NULL,
	`views` integer NOT NULL,
	PRIMARY KEY(`link`, `day`, `viewer`)
);
--> statement-breakpoint
CREATE TABLE `drop_viewers` (
	`link` text NOT NULL,
	`day` integer NOT NULL,
	`id` text NOT NULL,
	`viewer` text NOT NULL,
	PRIMARY KEY(`link`, `day`, `id`)
);
--> statement-breakpoint
CREATE INDEX `drop_viewers_day_idx` ON `drop_viewers` (`day`);--> statement-breakpoint
CREATE TRIGGER `drop_viewers_count` AFTER INSERT ON `drop_viewers` BEGIN
  INSERT OR IGNORE INTO `drop_views` (`link`, `day`, `viewer`, `views`) VALUES (NEW.link, NEW.day, NEW.viewer, 0);
  UPDATE `drop_views` SET `views` = `views` + 1 WHERE `link` = NEW.link AND `day` = NEW.day AND `viewer` = NEW.viewer;
END;
--> statement-breakpoint
-- The count goes with the doc's last version. A drop from before links were per doc is keyed on its id.
CREATE TRIGGER `drop_views_drop_delete` AFTER DELETE ON `drops`
WHEN NOT EXISTS (SELECT 1 FROM drops d WHERE d.link = OLD.link) BEGIN
  DELETE FROM `drop_views` WHERE `link` = coalesce(OLD.link, OLD.id);
  DELETE FROM `drop_viewers` WHERE `link` = coalesce(OLD.link, OLD.id);
END;
--> statement-breakpoint
-- The links a drop points to (server/utils/resources.ts), per doc: they go with its last version.
CREATE TABLE `drop_resources` (
	`link` text NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`position` integer NOT NULL,
	PRIMARY KEY(`link`, `url`)
);
--> statement-breakpoint
CREATE TRIGGER `drop_resources_drop_delete` AFTER DELETE ON `drops`
WHEN NOT EXISTS (SELECT 1 FROM drops d WHERE d.link = OLD.link) BEGIN
  DELETE FROM `drop_resources` WHERE `link` = coalesce(OLD.link, OLD.id);
END;
