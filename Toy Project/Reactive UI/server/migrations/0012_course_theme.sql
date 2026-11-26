-- How the shared page looks: 'plain' (the usual paper) or 'holiday' (winter night, snow and
-- string lights), chosen per course by the planner.
ALTER TABLE courses ADD COLUMN theme TEXT NOT NULL DEFAULT 'plain';
