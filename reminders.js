const pool = require('./db');

// Settings (the admin can change these)
const offsets = () => (process.env.REMINDER_OFFSETS || '1440,120,30').split(',').map(Number); // minutes before
const feedbackDelay = () => Number(process.env.FEEDBACK_DELAY || 15);                          // minutes after

const fmt = (d) => d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtTime = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function human(mins) {
  if (mins >= 1320) { const d = Math.round(mins / 1440); return `${d} day${d > 1 ? 's' : ''}`; }
  if (mins >= 60) { const h = Math.floor(mins / 60), m = mins % 60; return m ? `${h} hr ${m} min` : `${h} hr`; }
  return `${Math.max(mins, 0)} min`;
}

// Called whenever a booking is created
async function queueForBooking(db, bookingId, start, end) {
  const now = new Date();
  for (const m of offsets()) {
    const at = new Date(start.getTime() - m * 60000);
    if (at > now) {
      await db.query(
        `INSERT INTO reminders (booking_id, kind, send_at) VALUES ($1, 'before', $2)`,
        [bookingId, at]
      );
    }
  }
  const fb = new Date(end.getTime() + feedbackDelay() * 60000);
  await db.query(
    `INSERT INTO reminders (booking_id, kind, send_at) VALUES ($1, 'feedback', $2)`,
    [bookingId, fb]
  );
}

let running = false;

// Called by the worker every minute
async function sendDue() {
  if (running) return;
  running = true;
  try {
    const { rows } = await pool.query(`
      SELECT r.id, r.booking_id, r.kind, r.send_at,
             b.title, b.start_time, b.end_time, b.status AS booking_status,
             v.name AS venue
      FROM reminders r
      JOIN bookings b ON b.id = r.booking_id
      JOIN venues v ON v.id = b.venue_id
      WHERE r.status = 'queued' AND r.send_at <= now()
      ORDER BY r.send_at`);

    // if several "before" reminders are due for one booking, only the latest is useful
    const latestBefore = {};
    for (const r of rows) if (r.kind === 'before') latestBefore[r.booking_id] = r.id;

    const now = new Date();
    for (const r of rows) {
      const cancelled = r.booking_status === 'cancelled';
      const started = r.kind === 'before' && now >= r.start_time;
      const superseded = r.kind === 'before' && latestBefore[r.booking_id] !== r.id;

      if (cancelled || started || superseded) {
        await pool.query(`UPDATE reminders SET status = 'skipped' WHERE id = $1`, [r.id]);
        continue;
      }

      if (r.kind === 'before') {
        const mins = Math.round((r.start_time - now) / 60000);
        console.log(`[REMINDER] "${r.title}" is in ${human(mins)}: ${r.venue}, ${fmt(r.start_time)} to ${fmtTime(r.end_time)}. Please be there on time.`);
      } else {
        console.log(`[FEEDBACK] How did "${r.title}" go? Tell us how long it really lasted and how many people came.`);
      }
      await pool.query(`UPDATE reminders SET status = 'sent', sent_at = now() WHERE id = $1`, [r.id]);
    }
  } finally {
    running = false;
  }
}

module.exports = { queueForBooking, sendDue };