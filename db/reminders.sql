CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  booking_id INT NOT NULL REFERENCES bookings(id),
  kind TEXT NOT NULL CHECK (kind IN ('before', 'feedback')),
  send_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'skipped')),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS reminders_due ON reminders (status, send_at);