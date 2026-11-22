-- Weather answers from Open-Meteo, per day and rounded place, so pages do not ask again on
-- every view. Days still to come are refreshed after an hour; a day that has passed is kept.
CREATE TABLE weather_cache (
    key        TEXT PRIMARY KEY,      -- "YYYY-MM-DD:lat:lng" (two decimals)
    body       TEXT NOT NULL,         -- the report as JSON
    fetched_at INTEGER NOT NULL       -- unix seconds
) STRICT;
