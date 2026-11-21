-- Photo on the candidate's card: picked by the planner, or filled from its Naver Map link.
-- Empty means no photo (the card keeps its colour artwork).
ALTER TABLE candidates ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
