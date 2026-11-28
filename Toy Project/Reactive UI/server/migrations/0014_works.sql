-- More kinds of steps. A movie, show or exhibition step shares one venue (the theater), and its
-- candidates are works: an info or booking link (its title and poster come from that page), a
-- start time and a running time. Pictures the planner uploads for a candidate (a poster, a photo
-- for a date at home) are kept here and served at /api/images/{id}.
ALTER TABLE candidates ADD COLUMN link_url TEXT NOT NULL DEFAULT '';
ALTER TABLE candidates ADD COLUMN starts_at TEXT NOT NULL DEFAULT '';
ALTER TABLE candidates ADD COLUMN runtime_min INTEGER;
ALTER TABLE steps ADD COLUMN venue_name TEXT NOT NULL DEFAULT '';
ALTER TABLE steps ADD COLUMN venue_url TEXT NOT NULL DEFAULT '';
ALTER TABLE steps ADD COLUMN venue_lat REAL;
ALTER TABLE steps ADD COLUMN venue_lng REAL;
CREATE TABLE candidate_images (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    bytes      BLOB NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;
