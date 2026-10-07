const pool = require('../db');
const model = require('./durationModel');
const { getActiveModel } = require('./predictor');

// Real feedback counts this many times in training, so the office's own
// experience outweighs the simulated starting data.
const FEEDBACK_WEIGHT = () => Number(process.env.FEEDBACK_WEIGHT || 3);
const isTest = (r) => r.id % 5 === 0; // the test set is never used for training

const err = (loaded, rows) =>
  model.errors(model.predictMany(loaded, rows), rows.map((r) => r.actual_minutes));

async function trainAndRegister() {
  const { rows: all } = await pool.query('SELECT * FROM training_examples ORDER BY id');
  if (all.length < 50) return { ok: false, reason: 'Not enough data. Run: npm run generate' };

  const testRows = all.filter(isTest);
  const baseRows = all.filter((r) => !isTest(r));
  const trainRows = [];
  for (const r of baseRows) {
    trainRows.push(r);
    if (r.source !== 'simulated') for (let i = 1; i < FEEDBACK_WEIGHT(); i++) trainRows.push(r);
  }

  const saved = model.train(trainRows);
  const loaded = model.load(saved);
  const mine = err(loaded, testRows);

  const mean = baseRows.reduce((s, r) => s + r.actual_minutes, 0) / baseRows.length;
  const baseline = model.errors(testRows.map(() => mean), testRows.map((r) => r.actual_minutes));
  const guessRows = testRows.filter((r) => r.scheduled_minutes != null);
  const guess = model.errors(guessRows.map((r) => r.scheduled_minutes), guessRows.map((r) => r.actual_minutes));

  // Compare with the model currently in use, on the same test set
  const active = await getActiveModel();
  let old = null, oldOffice = null, newOffice = null;
  const officeTest = testRows.filter((r) => r.source !== 'simulated');
  if (active) {
    old = err(active.loaded, testRows);
    if (officeTest.length) { oldOffice = err(active.loaded, officeTest); newOffice = err(loaded, officeTest); }
  }
  // Keep the new model if it is better overall, or clearly better on the office's own
  // meetings without getting meaningfully worse overall (5% allowance).
  const accept = !active || mine.mae <= old.mae ||
    (newOffice && newOffice.mae < oldOffice.mae && mine.mae <= old.mae * 1.05);

  const { rows: v } = await pool.query('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM model_registry');
  const nFeedback = baseRows.filter((r) => r.source !== 'simulated').length;
  const betterOverall = active && mine.mae <= old.mae;
  const note = !active
    ? 'First model'
    : betterOverall
      ? `Better than v${active.version} (${old.mae.toFixed(1)} to ${mine.mae.toFixed(1)} min average error). Now in use.`
      : accept
        ? `Better on the office's own meetings (${oldOffice.mae.toFixed(1)} to ${newOffice.mae.toFixed(1)} min error) and about the same overall. Now in use.`
        : `Not better than v${active.version}. Kept the old model.`;

  if (accept) await pool.query('UPDATE model_registry SET is_active = false');
  await pool.query(
    `INSERT INTO model_registry (version, n_train, n_test, mae, rmse, baseline_mae, guess_mae, model_json, is_active, n_feedback, note, office_mae, n_office_test)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [v[0].next, baseRows.length, testRows.length, mine.mae.toFixed(2), mine.rmse.toFixed(2),
     baseline.mae.toFixed(2), guess.mae.toFixed(2), JSON.stringify(saved), accept, nFeedback, note,
     newOffice ? newOffice.mae.toFixed(2) : (officeTest.length ? err(loaded, officeTest).mae.toFixed(2) : null), officeTest.length]
  );

  return {
    ok: true, accept, version: v[0].next, note, nTrain: baseRows.length, nTest: testRows.length, nFeedback,
    mine, baseline, guess, old, oldOffice, newOffice, officeTestCount: officeTest.length,
    oldVersion: active ? active.version : null,
  };
}

module.exports = { trainAndRegister };