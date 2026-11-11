-- A free team's member limit holds under concurrent requests. Better Auth counts a team's members and invitations, then
-- inserts in a separate query, so two invitations or acceptances could both pass the count at the last free seat.
-- Drop writes the team's limit to `member_limit` before each of them (server/utils/teams.ts holdMemberLimit), and these
-- triggers refuse the insert itself past it: an invitation when members and pending invitations fill the limit, as
-- Drop's invitation limit counts them, and a member when members alone do, as Better Auth's membership limit counts
-- them. Null means no limit.
ALTER TABLE `organization` ADD `member_limit` integer;
--> statement-breakpoint
CREATE TRIGGER `member_limit_invitation` BEFORE INSERT ON `invitation` WHEN NEW.`status` = 'pending' AND (SELECT `member_limit` FROM `organization` WHERE `id` = NEW.`organization_id`) IS NOT NULL BEGIN SELECT RAISE(ABORT, 'DROP_TEAM_FULL') WHERE (SELECT count(*) FROM `member` WHERE `organization_id` = NEW.`organization_id`) + (SELECT count(*) FROM `invitation` WHERE `organization_id` = NEW.`organization_id` AND `status` = 'pending' AND `expires_at` > cast(unixepoch('subsecond') * 1000 as integer)) >= (SELECT `member_limit` FROM `organization` WHERE `id` = NEW.`organization_id`); END;
--> statement-breakpoint
CREATE TRIGGER `member_limit_member` BEFORE INSERT ON `member` WHEN (SELECT `member_limit` FROM `organization` WHERE `id` = NEW.`organization_id`) IS NOT NULL BEGIN SELECT RAISE(ABORT, 'DROP_TEAM_FULL') WHERE (SELECT count(*) FROM `member` WHERE `organization_id` = NEW.`organization_id`) >= (SELECT `member_limit` FROM `organization` WHERE `id` = NEW.`organization_id`); END;
