// The same conditional INSERT runs on D1 and in the SQLite concurrency tests.
export const usageCTE = `WITH scope AS (SELECT ? AS owner, ? AS month), usage AS (
  SELECT
    (SELECT count(*) FROM drops d WHERE owner_id = (SELECT owner FROM scope) AND NOT EXISTS (SELECT 1 FROM drops p WHERE p.id = d.supersedes_id AND p.owner_id = d.owner_id))
      + (SELECT coalesce(sum(drops), 0) FROM quota_reservations WHERE owner_id = (SELECT owner FROM scope) AND committed = 0) AS drops,
    (SELECT coalesce(sum(size), 0) FROM drops WHERE owner_id = (SELECT owner FROM scope) AND kind != 'app')
      + (SELECT coalesce(sum(f.size), 0) FROM drop_files f JOIN drops d ON d.id = f.drop_id WHERE d.owner_id = (SELECT owner FROM scope))
      + (SELECT coalesce(sum(size), 0) FROM quota_blobs WHERE owner_id = (SELECT owner FROM scope))
      + (SELECT coalesce(sum(bytes), 0) FROM quota_reservations WHERE owner_id = (SELECT owner FROM scope) AND committed = 0) AS bytes,
    (SELECT coalesce(sum(writes), 0) FROM quota_reservations WHERE owner_id = (SELECT owner FROM scope) AND month = (SELECT month FROM scope)) AS writes
)`
export const usageSQL = `${usageCTE} SELECT * FROM usage`
export const reserveSQL = `${usageCTE}
  INSERT INTO quota_reservations (id, owner_id, month, drops, bytes, writes, target_id, created_at)
  SELECT ?, (SELECT owner FROM scope), (SELECT month FROM scope), ?, ?, ?, ?, ? FROM usage
  WHERE (? = 0 OR drops + ? <= max(drops, ?)) AND (? = 0 OR bytes + ? <= max(bytes, ?)) AND (? = 0 OR writes + ? <= ?)
  RETURNING id`
