const pool = require('./db');
const { trainAndRegister } = require('./ai/trainer');
const { startRetrain } = require('./ai/retrainJob');

// After this many new real feedback entries, the system retrains itself
const RETRAIN_AFTER = () => Number(process.env.RETRAIN_AFTER || 20);

async function recordFeedback({ bookingId, minutes, attendees, comment = null, background = false }) {
  const client = await pool.connect();
  let booking;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT b.*, EXISTS (SELECT 1 FROM feedback f WHERE f.booking_id = b.id) AS has_feedback
       FROM bookings b WHERE b.id = $1 FOR UPDATE`,
      [bookingId]
    );
    if (rows.length === 0) throw new Error(`There is no booking with id ${bookingId}.`);
    booking = rows[0];
    if (booking.status === 'cancelled') throw new Error('That meeting was cancelled, so it has no feedback.');
    if (booking.has_feedback) throw new Error('Feedback was already given for that meeting.');
    if (booking.start_time > new Date()) throw new Error('That meeting has not started yet. Feedback can be given once it has taken place.');

    await client.query(
      `INSERT INTO feedback (booking_id, actual_minutes, actual_attendees, comment) VALUES ($1, $2, $3, $4)`,
      [bookingId, minutes, attendees, comment]
    );
    await client.query(`UPDATE bookings SET status = 'completed' WHERE id = $1`, [bookingId]);
    // this meeting becomes a new example for the model to learn from
    await client.query(
      `INSERT INTO training_examples (description, attendees, scheduled_minutes, actual_minutes, source, booking_id)
       VALUES ($1, $2, $3, $4, 'feedback', $5)`,
      [booking.description || booking.title, booking.expected_attendees,
       Math.round((booking.end_time - booking.start_time) / 60000), minutes, bookingId]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const scheduled = Math.round((booking.end_time - booking.start_time) / 60000);
  const result = { title: booking.title, scheduled, predicted: booking.predicted_minutes, actual: minutes, expected: booking.expected_attendees, attended: attendees };

  // retrain automatically once enough new real feedback has arrived
  const { rows: c } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM training_examples
     WHERE source = 'feedback' AND created_at > COALESCE((SELECT MAX(trained_at) FROM model_registry), 'epoch')`
  );
  result.newSinceTraining = c[0].n;
  result.retrainAfter = RETRAIN_AFTER();
  if (c[0].n >= RETRAIN_AFTER()) {
    if (background) result.retrainStarted = startRetrain().started; // the app keeps working while it trains
    else result.retrain = await trainAndRegister();
  }
  return result;
}

module.exports = { recordFeedback };