-- The wishlist: places someone wants to go, added from the archive with a map link. The planner
-- turns them into candidates; candidates remember the wish they came from, so a wish shows
-- "다녀왔어" once a finished course picked it. Wishes are soft-deleted (candidates may point here).
CREATE TABLE wishes (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    name       TEXT NOT NULL,
    memo       TEXT NOT NULL DEFAULT '',
    map_url    TEXT NOT NULL DEFAULT '',
    image_url  TEXT NOT NULL DEFAULT '',
    category   TEXT NOT NULL DEFAULT '',   -- e.g. 중식당 (from the map page)
    area       TEXT NOT NULL DEFAULT '',   -- e.g. 논현동
    lat        REAL,
    lng        REAL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    deleted_at INTEGER
) STRICT;

ALTER TABLE candidates ADD COLUMN wish_id TEXT;
