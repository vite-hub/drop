-- Better Auth counts its rate limits (client registration, sign-in) here: `rateLimit` in
-- server/auth.ts. Drop builds its Auth for each request, so a counter in memory would start at zero every time.
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);
