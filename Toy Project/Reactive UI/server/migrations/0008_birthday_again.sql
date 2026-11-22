-- Back to the birthday: passkeys are gone again, the guesses table returns (as in 0005).
DROP TABLE sessions;
DROP TABLE invites;
DROP TABLE passkeys;
DROP TABLE people;

CREATE TABLE archive_attempts (
    id      INTEGER PRIMARY KEY,
    address TEXT NOT NULL,               -- IPv4, or the IPv6 /64
    agent   TEXT NOT NULL DEFAULT '',    -- User-Agent, cut to 300 characters
    ok      INTEGER NOT NULL,            -- 1 = right code
    at      INTEGER NOT NULL             -- unix seconds
) STRICT;
CREATE INDEX archive_attempts_by_address ON archive_attempts (address, id);
CREATE INDEX archive_attempts_by_time ON archive_attempts (at);
