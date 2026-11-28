-- What really happened at a stop when the day went its own way. The planned place stays (the
-- ticket shows it struck through); this row says where they went instead, or that they skipped
-- it. Written by either of them after signing in with the birthday.
CREATE TABLE step_actual (
    step_id    TEXT PRIMARY KEY REFERENCES steps(id),
    skipped    INTEGER NOT NULL DEFAULT 0,
    name       TEXT NOT NULL DEFAULT '',
    memo       TEXT NOT NULL DEFAULT '',
    map_url    TEXT NOT NULL DEFAULT '',
    image_url  TEXT NOT NULL DEFAULT '',
    lat        REAL,
    lng        REAL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
