-- The holiday look became one switch for every page behind the birthday (app_info 'theme'),
-- so courses no longer carry their own.
ALTER TABLE courses DROP COLUMN theme;
