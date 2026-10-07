CREATE EXTENSION IF NOT EXISTS btree_gist;

DROP TABLE IF EXISTS reminders;
DROP TABLE IF EXISTS feedback;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS officers;
DROP TABLE IF EXISTS venues;

CREATE TABLE venues (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  capacity INT NOT NULL CHECK (capacity > 0)
);

CREATE TABLE officers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT
);

CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  venue_id INT NOT NULL REFERENCES venues(id),
  officer_id INT REFERENCES officers(id),
  expected_attendees INT NOT NULL CHECK (expected_attendees > 0),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  urgency TEXT CHECK (urgency IN ('low','medium','high')),
  predicted_minutes INT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','completed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),

  CONSTRAINT no_venue_clash EXCLUDE USING gist (
    venue_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  ) WHERE (status <> 'cancelled'),

  CONSTRAINT no_officer_clash EXCLUDE USING gist (
    officer_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  ) WHERE (status <> 'cancelled' AND officer_id IS NOT NULL)
);

CREATE TABLE feedback (
  id SERIAL PRIMARY KEY,
  booking_id INT NOT NULL UNIQUE REFERENCES bookings(id),
  actual_minutes INT NOT NULL CHECK (actual_minutes > 0),
  actual_attendees INT NOT NULL CHECK (actual_attendees >= 0),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);