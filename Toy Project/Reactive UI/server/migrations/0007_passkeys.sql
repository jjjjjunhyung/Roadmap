-- Passkeys replace the birthday: the people who may open the archive, their registered devices,
-- the single-use links that register a device, and sessions. Link and session tokens are stored
-- as SHA-256 only. Times are unix seconds.
DROP TABLE archive_attempts;
DELETE FROM app_info WHERE key IN ('archive_locked_at', 'archive_cleared_at');

CREATE TABLE people (
    id         TEXT PRIMARY KEY,           -- UUID, also the WebAuthn user handle
    name       TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE passkeys (
    id         TEXT PRIMARY KEY,           -- credential id (hex)
    person_id  TEXT NOT NULL REFERENCES people (id),
    passkey    TEXT NOT NULL,              -- webauthn-rs Passkey as JSON (public key, counter)
    agent      TEXT NOT NULL DEFAULT '',   -- User-Agent at registration
    created_at INTEGER NOT NULL,
    used_at    INTEGER NOT NULL
) STRICT;
CREATE INDEX passkeys_by_person ON passkeys (person_id);

CREATE TABLE invites (
    id         TEXT PRIMARY KEY,           -- SHA-256 of the link token
    person_id  TEXT NOT NULL REFERENCES people (id),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
) STRICT;

CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,           -- SHA-256 of the cookie token
    person_id  TEXT NOT NULL REFERENCES people (id),
    passkey_id TEXT,                       -- null when opened by a link alone
    agent      TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    seen_at    INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_by_person ON sessions (person_id);
