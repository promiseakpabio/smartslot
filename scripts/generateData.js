const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { generate } = require('../ai/simulate');

(async () => {
  const rows = generate(600);

  fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });
  const csv = ['description,attendees,scheduled_minutes,actual_minutes']
    .concat(rows.map((r) => `"${r.description}",${r.attendees},${r.scheduled_minutes},${r.actual_minutes}`))
    .join('\n');
  fs.writeFileSync(path.join(__dirname, '../data/meetings.csv'), csv);

  await pool.query(`DELETE FROM training_examples WHERE source = 'simulated'`);
  for (const r of rows) {
    await pool.query(
      `INSERT INTO training_examples (description, attendees, scheduled_minutes, actual_minutes, source)
       VALUES ($1, $2, $3, $4, 'simulated')`,
      [r.description, r.attendees, r.scheduled_minutes, r.actual_minutes]
    );
  }
  console.log(`Loaded ${rows.length} simulated meetings into the database.`);
  console.log('A copy was saved to data/meetings.csv');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });