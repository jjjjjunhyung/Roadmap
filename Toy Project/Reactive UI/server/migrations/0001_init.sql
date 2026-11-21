-- Baseline migration. Application tables are added in later migrations.
CREATE TABLE IF NOT EXISTS app_info (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT;

INSERT OR IGNORE INTO app_info (key, value) VALUES ('created_at', datetime('now'));
