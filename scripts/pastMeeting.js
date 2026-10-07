// TESTING HELPER: creates a meeting that already took place, so you can try the feedback command.
const pool = require('../db');
const { getActiveModel, predictWith } = require('../ai/predictor');

(async () => {
  const [title, people] = process.argv.slice(2);
  const attendees = Number(people);
  if (!title || !attendees) {
    console.log('Usage: npm run pastmeeting -- "Budget review with the finance team" 12');
    return pool.end();
  }
  const active = await getActiveModel();
  const predicted = active ? predictWith(active, title, attendees) : null;
  const { rows: venues } = await pool.query('SELECT id FROM venues WHERE capacity >= $1 ORDER BY capacity', [attendees]);
  if (!venues.length) { console.log('No venue is big enough.'); return pool.end(); }

  for (let attempt = 0; attempt < 15; attempt++) {
    const start = new Date();
    start.setDate(start.getDate() - (2 + Math.floor(Math.random() * 40)));
    start.setHours(14, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60000);
    try {
      const { rows } = await pool.query(
        `INSERT INTO bookings (title, description, venue_id, expected_attendees, start_time, end_time, predicted_minutes)
         VALUES ($1, $1, $2, $3, $4, $5, $6) RETURNING id`,
        [title, venues[0].id, attendees, start, end, predicted]
      );
      console.log(`Created past meeting #${rows[0].id}: "${title}", ${attendees} people, booked for 60 minutes.`);
      console.log(`Now give feedback, for example: npm run feedback -- ${rows[0].id} It lasted 95 minutes and 10 people came`);
      break;
    } catch (e) {
      if (!e.constraint) throw e;
    }
  }
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });