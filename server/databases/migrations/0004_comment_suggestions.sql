-- Suggestions now live in ViteHub thread metadata, and the next migration removes the legacy comments table.
-- Keep this ledger entry for parent databases that already applied it, without requiring the old table on child upgrades.
SELECT 1;
