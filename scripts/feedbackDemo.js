// DEMO ONLY: adds past meetings with feedback so you can show the learning loop.
// In this simulation, this office's meetings run about 35% longer than the starting data.
// Rows are marked as 'demo' so they are never confused with real feedback.
//   npm run feedbackdemo -- 30      adds 30 more past meetings
//   npm run feedbackdemo -- reset   removes all demo meetings
const pool = require('../db');
const { generate } = require('../ai/simulate');
const { getActiveModel, predictWith } = require('../ai/predictor');

(async () => {
  const arg = process.argv[2] || '30';

  if (arg === 'reset') {
    const { rows: old } = await pool.query(`SELECT booking_id FROM feedback WHERE comment = 'demo'`);
    await pool.query(`DELETE FROM feedback WHERE comment = 'demo'`);
    if (old.length) await pool.query('DELETE FROM bookings WHERE id = ANY($1)', [old.map((r) => r.booking_id)]);
    await pool.query(`DELETE FROM training_examples WHERE source = 'demo'`);
    console.log('Demo meetings removed.');
    return pool.end();
  }

  const N = Number(arg);
  const { rows: ex } = await pool.query(`SELECT COUNT(*)::int AS n FROM feedback WHERE comment = 'demo'`);
  const existing = ex[0].n;
  const { rows: venues } = await pool.query('SELECT id FROM venues ORDER BY id');
  const active = await getActiveModel();
  const rows = generate(N, 99 + existing, 1.35);

  for (let i = 0; i < N; i++) {
    const r = rows[i];
    const start = new Date();
    start.setDate(start.getDate() - (existing + i + 1));
    start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + r.scheduled_minutes * 60000);
    const predicted = active ? predictWith(active, r.description, r.attendees) : null;
    const { rows: b } = await pool.query(
      `INSERT INTO bookings (title, description, venue_id, expected_attendees, start_time, end_time, predicted_minutes, status)
       VALUES ($1, $1, $2, $3, $4, $5, $6, 'completed') RETURNING id`,
      [r.description, venues[(existing + i) % venues.length].id, r.attendees, start, end, predicted]
    );
    const came = Math.max(1, Math.round(r.attendees * (0.65 + 0.35 * Math.random())));
    await pool.query(
      `INSERT INTO feedback (booking_id, actual_minutes, actual_attendees, comment) VALUES ($1, $2, $3, 'demo')`,
      [b[0].id, r.actual_minutes, came]
    );
    await pool.query(
      `INSERT INTO training_examples (description, attendees, scheduled_minutes, actual_minutes, source, booking_id)
       VALUES ($1, $2, $3, $4, 'demo', $5)`,
      [r.description, r.attendees, r.scheduled_minutes, r.actual_minutes, b[0].id]
    );
  }
  console.log(`Added ${N} past meetings with feedback (total demo meetings: ${existing + N}).`);
  console.log('Now run: npm run train');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });