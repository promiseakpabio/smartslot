const pool = require('../db');

(async () => {
  const id = Number(process.argv[2]);
  if (!id) {
    console.log('Usage: npm run cancel -- <booking id>');
    return pool.end();
  }
  const { rows } = await pool.query(
    `UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND status = 'scheduled' RETURNING title`,
    [id]
  );
  if (rows.length === 0) {
    console.log(`No active booking with id ${id}.`);
  } else {
    await pool.query(`UPDATE reminders SET status = 'skipped' WHERE booking_id = $1 AND status = 'queued'`, [id]);
    console.log(`Cancelled "${rows[0].title}". Its reminders are cancelled and the slot is free again.`);
  }
  await pool.end();
})();