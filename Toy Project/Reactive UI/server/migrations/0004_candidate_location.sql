-- Where the candidate is, read from its Naver Map link; drives the course map on the ticket.
ALTER TABLE candidates ADD COLUMN lat REAL;
ALTER TABLE candidates ADD COLUMN lng REAL;
