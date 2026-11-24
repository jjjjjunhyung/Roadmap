-- Who decided a step: 'picker' (chosen in a game) or 'planner' (the step has a single candidate,
-- so it is fixed: "정해 둠"). Picks so far were all made in games.
ALTER TABLE steps ADD COLUMN picked_by TEXT;
UPDATE steps SET picked_by = 'picker' WHERE picked_id IS NOT NULL;
