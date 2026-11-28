-- Places they dropped by on the day that were never in the plan (after dinner, karaoke on a
-- whim). Each sits after one of the course's stops on the ticket; written by either of them
-- after signing in with the birthday.
CREATE TABLE extra_stops (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    course_id     TEXT NOT NULL REFERENCES courses(id),
    after_step_id TEXT,
    time          TEXT NOT NULL DEFAULT '',
    kind          TEXT NOT NULL,
    name          TEXT NOT NULL,
    memo          TEXT NOT NULL DEFAULT '',
    map_url       TEXT NOT NULL DEFAULT '',
    image_url     TEXT NOT NULL DEFAULT '',
    lat           REAL,
    lng           REAL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
CREATE INDEX extra_stops_course ON extra_stops (course_id);
