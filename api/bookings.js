const express = require('express');
const pool = require('../db');
const { smartSchedule } = require('../smart');
const { parseFeedback } = require('../ai/feedbackParser');
const { recordFeedback } = require('../feedback');
const { requireAuth } = require('./auth');
const { runAs } = require('../ctx');

const router = express.Router();
router.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toDate = (d, t) => {
  const [y, mo, day] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(y, mo - 1, day, h, mi, 0, 0);
};
const todayStr = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};
// Only plain advice reaches the app. Terminal commands and developer flags are removed here.
const toOptions = (fix) =>
  String(fix || '').split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
    .filter((l) => !/--force|--split/i.test(l))
    .map((l) => l
      .replace(/,?\s*or\s+register a bigger venue with:?\s*npm run.*$/i, ', or ask an admin to add a bigger room.')
      .replace(/(add one with|register[^:]*with):?\s*npm run.*$/i, 'Add a room on the Rooms page.')
      .replace(/\s*npm run.*$/i, ''))
    .filter(Boolean);
const clean = (s) => String(s || '').replace(/\s*\(model v\d+\)/i, '');
const safeNotes = (n) => (n || []).filter((x) => !/--force|--split|npm run/i.test(String(x)));

// Turn the request body into the arguments smartSchedule expects. Returns { error } if invalid.
function readSchedule(body) {
  const attendees = Number(body.attendees);
  if (!Number.isInteger(attendees) || attendees < 1 || attendees > 10000) return { error: 'Number of people must be a whole number of at least 1.' };
  let minutes = null;
  if (body.minutes !== undefined && body.minutes !== null && body.minutes !== '') {
    minutes = Number(body.minutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) return { error: 'Minutes must be a whole number between 5 and 1440.' };
  }
  if (body.date && !DATE_RE.test(body.date)) return { error: 'The date must look like 2026-10-13.' };
  if ((body.from && !TIME_RE.test(body.from)) || (body.to && !TIME_RE.test(body.to))) return { error: 'Times must look like 09:30.' };

  let start = null, end = null, from = null;
  if (body.from || body.to) {
    if (!(body.from && body.to)) return { error: 'Give both a start time and an end time.' };
    const date = body.date || todayStr();
    start = toDate(date, body.from);
    end = toDate(date, body.to);
  } else if (body.date) {
    from = new Date(Math.max(toDate(body.date, '00:00'), new Date()));
  }
  if (start && end) {
    if (end <= start) return { error: 'The end time must be after the start time.' };
    if ((end - start) / 60000 < 5) return { error: 'A meeting must last at least 5 minutes.' };
  }
  if (start && start < new Date()) return { error: 'That start time has already passed. Please choose a time in the future.' };
  return { attendees, minutes, start, end, from, venueName: body.room || null, split: Boolean(body.split), force: Boolean(body.force) };
}

// Turn smartSchedule's answer into JSON for the app
function answer(r) {
  if (r.ok && r.multi) {
    return { ok: true, bookings: r.sessions.map((s) => ({ id: s.id, venue: s.venue, start: s.start, end: s.end })), notes: safeNotes(r.notes) };
  }
  if (r.ok) {
    return { ok: true, bookings: [{ id: r.bookingId, venue: r.venue, start: r.start, end: r.end }], notes: safeNotes(r.notes), note: r.note || null };
  }
  return { ok: false, reason: clean(r.reason), options: toOptions(r.fix), notes: safeNotes(r.notes), needsSplit: Boolean(r.needsSplit) };
}

async function stamp(res, ids, userId) {
  await pool.query('UPDATE bookings SET created_by = $1 WHERE id = ANY($2)', [userId, ids]);
  return res;
}

// A booking the current user may touch: their own, or any if admin
async function loadBooking(req, res) {
  const { rows } = await pool.query(
    `SELECT b.*, v.name AS venue_name FROM bookings b JOIN venues v ON v.id = b.venue_id WHERE b.id = $1`,
    [Number(req.params.id)]
  );
  if (rows.length === 0) { res.status(404).json({ error: 'No meeting with that number.' }); return null; }
  const b = rows[0];
  if (req.user.role !== 'admin' && b.created_by !== req.user.id) { res.status(403).json({ error: 'That meeting belongs to someone else.' }); return null; }
  return b;
}

// Create a booking
router.post('/', async (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim();
  if (!title || title.length > 120) return res.status(400).json({ error: 'Please give the meeting a title (up to 120 characters).' });
  const args = readSchedule(body);
  if (args.error) return res.status(400).json({ error: args.error });

  const r = await runAs(req.user.id, () => smartSchedule({ title, about: body.about ? String(body.about).trim() : null, ...args }));
  if (r.ok) {
    const ids = r.multi ? r.sessions.map((s) => s.id) : [r.bookingId];
    await stamp(null, ids, req.user.id);
  }
  res.json(answer(r));
});

// List bookings
router.get('/', async (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.user.role !== 'admin') { params.push(req.user.id); where += ` AND b.created_by = $${params.length}`; }
  if (req.query.status) { params.push(String(req.query.status)); where += ` AND b.status = $${params.length}`; }
  if (req.query.when === 'upcoming') where += ` AND b.start_time >= now() AND b.status = 'scheduled'`;
  const { rows } = await pool.query(
    `SELECT b.id, b.title, b.description, b.expected_attendees AS attendees, b.start_time, b.end_time, b.status,
            b.predicted_minutes, v.name AS venue, f.actual_minutes, f.actual_attendees,
            (b.status = 'scheduled' AND b.end_time < now() AND f.id IS NULL) AS needs_feedback
     FROM bookings b
     JOIN venues v ON v.id = b.venue_id
     LEFT JOIN feedback f ON f.booking_id = b.id
     WHERE ${where}
     ORDER BY b.start_time DESC LIMIT 200`,
    params
  );
  res.json({ bookings: rows });
});

// Cancel
router.post('/:id/cancel', async (req, res) => {
  const b = await loadBooking(req, res);
  if (!b) return;
  if (b.status !== 'scheduled') return res.status(400).json({ error: `That meeting is already ${b.status}.` });
  await pool.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [b.id]);
  await pool.query(`UPDATE reminders SET status = 'skipped' WHERE booking_id = $1 AND status = 'queued'`, [b.id]);
  res.json({ ok: true, message: `"${b.title}" was cancelled and the room is free again.` });
});

// Reschedule: change the date, time, room or length. If the new slot is not free, nothing changes.
router.post('/:id/reschedule', async (req, res) => {
  const b = await loadBooking(req, res);
  if (!b) return;
  if (b.status !== 'scheduled') return res.status(400).json({ error: `A ${b.status} meeting cannot be rescheduled.` });
  if (b.start_time <= new Date()) return res.status(400).json({ error: 'That meeting has already started.' });

  const body = req.body || {};
  const oldMinutes = Math.round((b.end_time - b.start_time) / 60000);
  const args = readSchedule({ attendees: b.expected_attendees, minutes: body.minutes || (body.from ? null : oldMinutes), date: body.date, from: body.from, to: body.to, room: body.room || b.venue_name });
  if (args.error) return res.status(400).json({ error: args.error });

  // free the old slot first, so the new time may overlap it; put it back if the move fails
  await pool.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [b.id]);
  let r;
  try {
    r = await runAs(b.created_by || req.user.id, () => smartSchedule({ title: b.title, description: b.description, ...args, force: true }));
  } catch (e) {
    await pool.query(`UPDATE bookings SET status = 'scheduled' WHERE id = $1`, [b.id]);
    throw e;
  }
  if (!r.ok) {
    try {
      await pool.query(`UPDATE bookings SET status = 'scheduled' WHERE id = $1`, [b.id]);
    } catch {
      return res.status(409).json({ error: 'Could not keep the original slot because someone booked it a moment ago.' });
    }
    return res.json({ ...answer(r), kept: 'Your original booking is unchanged.' });
  }
  const ids = r.multi ? r.sessions.map((s) => s.id) : [r.bookingId];
  await pool.query('UPDATE bookings SET created_by = $1 WHERE id = ANY($2)', [b.created_by, ids]);
  await pool.query(`UPDATE reminders SET status = 'skipped' WHERE booking_id = $1 AND status = 'queued'`, [b.id]);
  res.json({ ...answer(r), message: 'Meeting rescheduled.' });
});

// Feedback after the meeting
router.post('/:id/feedback', async (req, res) => {
  const b = await loadBooking(req, res);
  if (!b) return;
  const body = req.body || {};
  const parsed = body.text ? parseFeedback(body.text) : { minutes: null, attendees: null };
  const minutes = body.minutes != null && body.minutes !== '' ? Number(body.minutes) : parsed.minutes;
  const attendees = body.attendees != null && body.attendees !== '' ? Number(body.attendees) : parsed.attendees;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440 || !Number.isInteger(attendees) || attendees < 0) {
    return res.status(400).json({
      error: 'Please say how long the meeting really lasted and how many people came, for example: It lasted 55 minutes and 10 people came.',
      understood: parsed,
    });
  }
  try {
    const r = await recordFeedback({ bookingId: b.id, minutes, attendees, comment: body.text || null, background: true });
    res.json({ ok: true, understood: { minutes, attendees }, summary: r });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
