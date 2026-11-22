-- The album: photos of a course's day, re-encoded by the server (no metadata) with a thumbnail.
-- Deleting one removes the row (photos are personal; no soft delete).
CREATE TABLE photos (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    course_id  TEXT NOT NULL REFERENCES courses (id),
    step_id    TEXT,                       -- the stop it was taken at; null for the day
    width      INTEGER NOT NULL,
    height     INTEGER NOT NULL,
    full       BLOB NOT NULL,              -- JPEG, longest side 1600
    thumb      BLOB NOT NULL,              -- JPEG, longest side 480
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;
CREATE INDEX photos_by_course ON photos (course_id, created_at);
