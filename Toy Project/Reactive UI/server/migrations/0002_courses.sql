-- Date courses: the planner prepares steps with candidates; the picker chooses one per step.
-- Rows are soft-deleted (deleted_at) because anyone with a link can edit.

CREATE TABLE courses (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    share_code TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(6)))),
    title      TEXT NOT NULL,
    date       TEXT NOT NULL,                       -- YYYY-MM-DD
    status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'done')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    deleted_at TEXT
) STRICT;

CREATE TABLE steps (
    id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    course_id    TEXT NOT NULL REFERENCES courses (id),
    position     INTEGER NOT NULL,
    kind         TEXT NOT NULL,                     -- icon: meal, cafe, play, dinner, drink, walk
    label        TEXT NOT NULL,                     -- short name shown in the itinerary
    title        TEXT NOT NULL,                     -- question shown to the picker
    time         TEXT NOT NULL DEFAULT '',          -- HH:MM or empty
    game         TEXT NOT NULL,                     -- selection game for this step
    rerolls      INTEGER NOT NULL DEFAULT 1,        -- "try again" chances for luck games
    rerolls_used INTEGER NOT NULL DEFAULT 0,
    picked_id    TEXT,                              -- chosen candidate (validated in code)
    picked_at    TEXT,
    deleted_at   TEXT
) STRICT;
CREATE INDEX steps_by_course ON steps (course_id, position) WHERE deleted_at IS NULL;

CREATE TABLE candidates (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    step_id    TEXT NOT NULL REFERENCES steps (id),
    position   INTEGER NOT NULL,
    name       TEXT NOT NULL,
    memo       TEXT NOT NULL DEFAULT '',
    map_url    TEXT NOT NULL DEFAULT '',
    deleted_at TEXT
) STRICT;
CREATE INDEX candidates_by_step ON candidates (step_id, position) WHERE deleted_at IS NULL;

-- Who changed what, so edits can be traced and undone by hand.
CREATE TABLE history (
    id         INTEGER PRIMARY KEY,
    course_id  TEXT NOT NULL,
    actor      TEXT NOT NULL CHECK (actor IN ('planner', 'picker')),
    action     TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
CREATE INDEX history_by_course ON history (course_id, id);
