process.env.REMINDER_OFFSETS = '3,2,1'; // minutes before, for the demo only
process.env.FEEDBACK_DELAY = '1';

const pool = require('../db');
const { queueForBooking } = require('../reminders');

(async () => {
  const start = new Date(Date.now() + 4 * 60000);
  const end = new Date(Date.now() + 5 * 60000);
  const { rows } = await pool.query(
    `INSERT INTO bookings (title, venue_id, expected_attendees, start_time, end_time)
     VALUES ('Demo meeting', 1, 5, $1, $2) RETURNING id`,
    [start, end]
  );
  await queueForBooking(pool, rows[0].id, start, end);
  console.log(`Demo booking #${rows[0].id} starts in 4 minutes. Watch the worker window.`);
  await pool.end();
})();