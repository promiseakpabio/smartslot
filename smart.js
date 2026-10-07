const pool = require('./db');
const { schedule, findExact, findFlexible } = require('./scheduler');
const { getActiveModel, predictWith } = require('./ai/predictor');

// How much shorter than the prediction is still acceptable (0.15 = 15%). Admin setting.
const TOLERANCE = () => Number(process.env.FEASIBLE_TOLERANCE || 0.15);
const ceil15 = (m) => Math.ceil(m / 15) * 15;
const fmt = (d) => d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtTime = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const isTooShort = (requested, predicted) => requested < predicted * (1 - TOLERANCE());

// Build the reason and the list of fixes. Every number comes from the model or the database.
async function explainTooShort({ active, description, attendees, requested, predicted, exact, start, venueName, from }) {
  const need = ceil15(predicted);
  const reason =
    `Meetings like this with ${attendees} people usually take about ${predicted} minutes, ` +
    `but you asked for ${requested}. That is probably too short (model v${active.version}).`;
  const options = [];

  // Fix 1: give it the time it needs, checked against the real diary
  if (exact) {
    const newEnd = new Date(start.getTime() + need * 60000);
    const r = await findExact({ attendees, start, end: newEnd, venueName });
    if (r.ok) {
      options.push(`Extend it to ${need} minutes (${fmtTime(start)} to ${fmtTime(newEnd)}): ${r.venue.name} is free.`);
    } else {
      options.push(`Extending to ${need} minutes does not fit that slot: ${r.reason}`);
      // reuse the diary search to offer real alternatives for the full length
      String(r.fix || '')
        .split('\n')
        .map((line) => line.replace(/^\s*-\s*/, '').trim())
        .filter(Boolean)
        .forEach((alt) => options.push(`For ${need} minutes: ${alt}`));
    }
  } else {
    const r = await findFlexible({ attendees, minutes: need, from: from || new Date(), venueName });
    options.push(
      r.ok
        ? `Book ${need} minutes instead: ${r.venue.name}, ${fmt(r.start)} to ${fmtTime(r.end)}.`
        : `Booking ${need} minutes is not possible yet. ${r.reason}`
    );
  }

  // Fix 2: fewer people, using the model to find the largest group that fits the time
  for (let n = attendees - 1; n >= 1; n--) {
    const p = predictWith(active, description, n);
    if (!isTooShort(requested, p)) {
      options.push(`Reduce the group to ${n} people (about ${p} minutes).`);
      break;
    }
  }

  // Fix 3: two smaller groups at the same length
  if (attendees >= 4) {
    const half = Math.ceil(attendees / 2);
    const p = predictWith(active, description, half);
    if (!isTooShort(requested, p)) {
      options.push(`Run two sessions of about ${half} people each (about ${p} minutes each).`);
    }
  }

  options.push('Or add --force to book the shorter time anyway.');
  return { ok: false, reason, fix: '\n' + options.map((o) => '  - ' + o).join('\n') };
}

async function smartSchedule(opts) {
  const { title, about = null, attendees, minutes = null, start = null, end = null, from = null, venueName = null, split = false, force = false } = opts;
  const description = opts.description || [title, about].filter(Boolean).join(' ');
  const exact = Boolean(start && end);
  let requested = exact ? Math.round((end - start) / 60000) : minutes;
  const notes = [];

  const active = await getActiveModel();
  const predicted = active ? predictWith(active, description, attendees) : null;

  if (!requested) {
    if (!predicted) {
      return { ok: false, reason: 'You did not give a length, and there is no trained model yet.', fix: 'Give the minutes, or run: npm run train', notes };
    }
    requested = ceil15(predicted);
    notes.push(`No length given, so SmartSlot used its own estimate: ${requested} minutes (model v${active.version}).`);
  } else if (predicted) {
    if (isTooShort(requested, predicted)) {
      if (!force) {
        const r = await explainTooShort({ active, description, attendees, requested, predicted, exact, start, venueName, from });
        return { ...r, notes };
      }
            notes.push(`Warning: meetings like this usually take about ${predicted} minutes, and ${requested} was booked as chosen.`);
    } else if (requested > predicted * 1.5 && requested - predicted >= 30) {
      notes.push(`Heads up: this is longer than usual (about ${predicted} minutes). A shorter slot would free the room for others.`);
    } else {
      notes.push(`Checked: meetings like this usually take about ${predicted} minutes, so ${requested} is enough.`);
    }
  }

  const res = await schedule({
    title, description, attendees,
    minutes: exact ? null : requested,
    start, end, from, venueName, split,
  });

  if (res.ok && predicted) {
    const ids = res.multi ? res.sessions.map((s) => s.id) : [res.bookingId];
    await pool.query('UPDATE bookings SET predicted_minutes = $1 WHERE id = ANY($2)', [predicted, ids]);
  }
  return { ...res, notes };
}

module.exports = { smartSchedule };