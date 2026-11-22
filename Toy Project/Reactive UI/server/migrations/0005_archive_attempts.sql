-- Guesses at the archive passcode: they drive the per-address waits and the daily limit, and the
-- planner page lists them. Kept for 30 days. The lock itself lives in app_info
-- ('archive_locked_at', 'archive_cleared_at', unix seconds).
CREATE TABLE archive_attempts (
    id      INTEGER PRIMARY KEY,
    address TEXT NOT NULL,               -- IPv4, or the IPv6 /64
    agent   TEXT NOT NULL DEFAULT '',    -- User-Agent, cut to 300 characters
    ok      INTEGER NOT NULL,            -- 1 = right code
    at      INTEGER NOT NULL             -- unix seconds
) STRICT;
CREATE INDEX archive_attempts_by_address ON archive_attempts (address, id);
CREATE INDEX archive_attempts_by_time ON archive_attempts (at);
