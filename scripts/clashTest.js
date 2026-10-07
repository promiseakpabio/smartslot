const pool = require('../db');

async function book(venueId, start, end, title) {
  try {
    await pool.query(
      `INSERT INTO bookings (title, venue_id, expected_attendees, start_time, end_time)
       VALUES ($1, $2, 5, $3, $4)`,
      [title, venueId, start, end]
    );
    console.log('BOOKED  :', title);
  } catch (e) {
    console.log('REJECTED:', title, '->', e.constraint || e.message);
  }
}

(async () => {
  await book(1, '2026-10-05 10:00+01', '2026-10-05 11:00+01', 'Budget review');
  await book(1, '2026-10-05 10:30+01', '2026-10-05 11:30+01', 'Overlapping meeting');
  await book(1, '2026-10-05 11:00+01', '2026-10-05 12:00+01', 'Back-to-back meeting');
  await pool.end();
})();