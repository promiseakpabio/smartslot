CREATE TABLE IF NOT EXISTS training_examples (
  id SERIAL PRIMARY KEY,
  description TEXT NOT NULL,
  attendees INT NOT NULL CHECK (attendees > 0),
  scheduled_minutes INT,
  actual_minutes INT NOT NULL CHECK (actual_minutes > 0),
  source TEXT NOT NULL DEFAULT 'simulated' CHECK (source IN ('simulated', 'feedback')),
  booking_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_registry (
  id SERIAL PRIMARY KEY,
  version INT NOT NULL,
  trained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  n_train INT NOT NULL,
  n_test INT NOT NULL,
  mae NUMERIC(8,2) NOT NULL,
  rmse NUMERIC(8,2) NOT NULL,
  baseline_mae NUMERIC(8,2) NOT NULL,
  guess_mae NUMERIC(8,2),
  model_json JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false
);