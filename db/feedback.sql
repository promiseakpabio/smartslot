ALTER TABLE training_examples DROP CONSTRAINT IF EXISTS training_examples_source_check;
ALTER TABLE training_examples ADD CONSTRAINT training_examples_source_check
  CHECK (source IN ('simulated', 'feedback', 'demo'));
ALTER TABLE model_registry ADD COLUMN IF NOT EXISTS n_feedback INT NOT NULL DEFAULT 0;
ALTER TABLE model_registry ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE model_registry ADD COLUMN IF NOT EXISTS office_mae NUMERIC(8,2);
ALTER TABLE model_registry ADD COLUMN IF NOT EXISTS n_office_test INT NOT NULL DEFAULT 0;