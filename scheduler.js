const pool = require('./db');
const { queueForBooking } = require('./reminders');
const { currentUser } = require('./ctx');

// Admin settings: change these to suit the office
const WORK_START = 8;      // 8:00
const WORK_END = 18;       // 18:00
const STEP_MIN = 15;       // try a new start time every 15 minutes
const SEARCH_DAYS = 14;    // how far ahead to look
const MAX_SESSION = 240;   // longest single meeting without a break (minutes)

const fmt = (d) => d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtTime = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const list = (venues) => venues.map((v) => `${v.name} (${v.capacity})`).join(', ');
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const isClash = (e) => e.constraint === 'no_venue_clash' || e.constraint === 'no_officer_clash';
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const atMinutes = (day, m) => { const x = new Date(day); x.setHours(Math.floor(m / 60), m % 60, 0, 0); return x; };
const minsOfDay = (d) => d.getHours() * 60 + d.getMinutes();

async function isFree(column, id, start, end) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM bookings
     WHERE ${column} = $1 AND status <> 'cancelled'
       AND tstzrange(start_time, end_time) && tstzrange($2, $3)
     LIMIT 1`,
    [id, start, end]
  );
  return rowCount === 0;
}

// First free venue/time, scanning weekdays inside working hours
async function searchVenues(venues, { minutes, from, officerId, days = SEARCH_DAYS }) {
  for (let d = 0; d < days; d++) {
    const day = startOfDay(from);
    day.setDate(day.getDate() + d);
    if (isWeekend(day)) continue;
    for (let m = WORK_START * 60; m + minutes <= WORK_END * 60; m += STEP_MIN) {
      const start = atMinutes(day, m);
      if (start < from) continue;
      const end = new Date(start.getTime() + minutes * 60000);
      if (officerId && !(await isFree('officer_id', officerId, start, end))) continue;
      for (const venue of venues) {
        if (await isFree('venue_id', venue.id, start, end)) return { venue, start, end };
      }
    }
  }
  return null;
}

// Which venues can be used: handles "no venue big enough" and a named room
async function pickVenues(attendees, venueName) {
    const { rows: all } = await pool.query('SELECT * FROM venues WHERE created_by IS NULL OR created_by = $1 ORDER BY capacity ASC', [currentUser()]);
  if (all.length === 0) {
    return { error: { ok: false, reason: 'No venues are registered yet.', fix: 'Add one with: npm run addvenue -- "Name" capacity' } };
  }
  const maxCap = all[all.length - 1].capacity;
  const fitting = all.filter((v) => v.capacity >= attendees);
  if (fitting.length === 0) {
    const groups = Math.ceil(attendees / maxCap);
    const per = Math.ceil(attendees / groups);
    return {
      error: {
        ok: false,
        reason: `No venue holds ${attendees} people. The largest holds ${maxCap}.`,
        fix: `Run ${groups} separate sessions of about ${per} people each, or register a bigger venue with: npm run addvenue -- "Name" ${attendees}`,
      },
    };
  }
  if (!venueName) return { all, fitting, candidates: fitting };

  const wanted = all.find((v) => v.name.toLowerCase() === venueName.toLowerCase());
  if (!wanted) {
    return { error: { ok: false, reason: `There is no venue called "${venueName}".`, fix: `Registered venues: ${list(all)}.` } };
  }
  if (wanted.capacity < attendees) {
    return {
      error: {
        ok: false,
        reason: `${wanted.name} holds ${wanted.capacity} people, but you have ${attendees}.`,
        fix: `Choose a bigger venue (${list(fitting)}) or reduce the group to ${wanted.capacity} or fewer.`,
      },
    };
  }
  return { all, fitting, candidates: [wanted] };
}

// For a long meeting: find real free slots on separate days
async function planSplit({ candidates, minutes, from, officerId }) {
  const sessions = Math.ceil(minutes / MAX_SESSION);
  const per = Math.ceil(minutes / sessions / STEP_MIN) * STEP_MIN;
  const plan = [];
  for (let d = 0; d < SEARCH_DAYS && plan.length < sessions; d++) {
    const day = startOfDay(from);
    day.setDate(day.getDate() + d);
    if (isWeekend(day)) continue;
    const slot = await searchVenues(candidates, { minutes: per, from: d === 0 ? from : day, officerId, days: 1 });
    if (slot) plan.push(slot);
  }
  return { sessions, per, plan };
}

function splitReply(minutes, split) {
  const hours = (minutes / 60).toFixed(1);
  const lines = split.plan.map((s, i) => `  ${i + 1}. ${s.venue.name}, ${fmt(s.start)} to ${fmtTime(s.end)}`).join('\n');
  const complete = split.plan.length === split.sessions;
  return {
    ok: false,
    needsSplit: true,
    split,
    reason: `${minutes} minutes (${hours} hours) is too long for one sitting. The limit is ${MAX_SESSION} minutes without a break.`,
    fix: complete
      ? `Split it into ${split.sessions} sessions of ${split.per} minutes on separate days:\n${lines}\n  To book all of them, run the same command with --split`
      : `It needs ${split.sessions} sessions of ${split.per} minutes, but only ${split.plan.length} free day(s) were found in the next ${SEARCH_DAYS} days.`,
  };
}

// Mode 1: user gives only the length, system finds the time
async function findFlexible({ attendees, minutes, from, officerId, venueName }) {
  const pick = await pickVenues(attendees, venueName);
  if (pick.error) return pick.error;

  if (minutes > MAX_SESSION) {
    const split = await planSplit({ candidates: pick.candidates, minutes, from, officerId });
    return splitReply(minutes, split);
  }

  const slot = await searchVenues(pick.candidates, { minutes, from, officerId });
  if (!slot) {
    const who = venueName ? pick.candidates[0].name : 'Any suitable venue';
    return {
      ok: false,
      reason: `${who} has no free ${minutes}-minute slot in the next ${SEARCH_DAYS} days.`,
      fix: venueName ? 'Try another venue, or shorten the meeting.' : 'Shorten the meeting or register more venues.',
    };
  }

  let note = null;
  if (venueName) {
    const any = await searchVenues(pick.fitting, { minutes, from, officerId });
    if (any && any.start < slot.start) note = `${any.venue.name} is free earlier, at ${fmt(any.start)}.`;
  }
  return { ok: true, ...slot, note };
}

// Nearest free time on the requested day
async function nearest(venues, start, minutes) {
  const day = startOfDay(start);
  const now = new Date();
  let best = null;
  for (let m = WORK_START * 60; m + minutes <= WORK_END * 60; m += STEP_MIN) {
    const s = atMinutes(day, m);
    if (s < now) continue;
    const e = new Date(s.getTime() + minutes * 60000);
    for (const v of venues) {
      if (await isFree('venue_id', v.id, s, e)) {
        const dist = Math.abs(s - start);
        if (!best || dist < best.dist) best = { venue: v, start: s, end: e, dist };
        break;
      }
    }
  }
  return best;
}

// Mode 2: user gives an exact start and end time
async function findExact({ attendees, start, end, officerId, venueName }) {
  const minutes = Math.round((end - start) / 60000);
  if (minutes <= 0) return { ok: false, reason: 'The end time is not after the start time.', fix: 'Check --from and --to.' };
  if (start < new Date()) return { ok: false, reason: 'That time has already passed.', fix: 'Choose a future date and time.' };

  const pick = await pickVenues(attendees, venueName);
  if (pick.error) return pick.error;

  if (minutes > MAX_SESSION) {
    const from = new Date(Math.max(startOfDay(start).getTime(), Date.now()));
    const split = await planSplit({ candidates: pick.candidates, minutes, from, officerId });
    return splitReply(minutes, split);
  }

  const inHours =
    start.toDateString() === end.toDateString() && !isWeekend(start) &&
    minsOfDay(start) >= WORK_START * 60 && minsOfDay(end) <= WORK_END * 60;
  if (!inHours) {
    const alt = await searchVenues(pick.candidates, { minutes, from: start, officerId });
    return {
      ok: false,
      reason: `Meetings can only run ${WORK_START}:00 to ${WORK_END}:00 on weekdays.`,
      fix: alt
        ? `The next ${minutes}-minute slot inside working hours is ${alt.venue.name}, ${fmt(alt.start)} to ${fmtTime(alt.end)}.`
        : `No free slot inside working hours in the next ${SEARCH_DAYS} days.`,
    };
  }

  if (officerId && !(await isFree('officer_id', officerId, start, end))) {
    return { ok: false, reason: 'The officer already has a meeting at that time.', fix: 'Choose another time.' };
  }

  for (const v of pick.candidates) {
    if (await isFree('venue_id', v.id, start, end)) return { ok: true, venue: v, start, end };
  }

  // Busy: build real options, each one checked against the database
  const options = [];
  if (venueName) {
    for (const v of pick.fitting) {
      if (v.id !== pick.candidates[0].id && (await isFree('venue_id', v.id, start, end))) {
        options.push(`Keep the time and use ${v.name} (${v.capacity}), which is free.`);
        break;
      }
    }
    const nb = await nearest(pick.candidates, start, minutes);
    if (nb) options.push(`Keep ${pick.candidates[0].name}, nearest free time that day: ${fmtTime(nb.start)} to ${fmtTime(nb.end)}.`);
  } else {
    const nb = await nearest(pick.fitting, start, minutes);
    if (nb) options.push(`Same day, nearest time: ${nb.venue.name}, ${fmtTime(nb.start)} to ${fmtTime(nb.end)}.`);
  }
  for (let d = 1; d <= 7; d++) {
    const s = new Date(start);
    s.setDate(s.getDate() + d);
    if (isWeekend(s)) continue;
    const e = new Date(s.getTime() + minutes * 60000);
    let found = null;
    for (const v of pick.candidates) {
      if (await isFree('venue_id', v.id, s, e)) { found = v; break; }
    }
    if (found) { options.push(`Same time on ${fmt(s)}: ${found.name}.`); break; }
  }

  const who = venueName ? pick.candidates[0].name : 'Every venue big enough';
  return {
    ok: false,
    reason: `${who} is already booked at ${fmt(start)} to ${fmtTime(end)}.`,
    fix: options.length ? '\n' + options.map((o) => '  - ' + o).join('\n') : 'No free alternative found in the next 7 days.',
  };
}

async function insertBooking(db, b) {
  const { rows } = await db.query(
    `INSERT INTO bookings
       (title, description, venue_id, officer_id, expected_attendees, start_time, end_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [b.title, b.description, b.venueId, b.officerId, b.attendees, b.start, b.end]
  );
  await queueForBooking(db, rows[0].id, b.start, b.end);
  return rows[0].id;
} 

async function insertOne({ title, description, attendees, officerId, slot }) {
  try {
    const id = await insertBooking(pool, { title, description, venueId: slot.venue.id, officerId, attendees, start: slot.start, end: slot.end });
    return { ok: true, bookingId: id, venue: slot.venue.name, start: slot.start, end: slot.end, note: slot.note };
  } catch (e) {
    if (isClash(e)) return { ok: false, retry: true, reason: 'That slot was taken a moment ago.', fix: 'Run the command again.' };
    throw e;
  }
}

// Book all split sessions together: all succeed or none do
async function bookSplit({ title, description, attendees, officerId, split }) {
  if (split.plan.length < split.sessions) {
    return { ok: false, reason: `Only ${split.plan.length} of ${split.sessions} sessions fit in the next ${SEARCH_DAYS} days.`, fix: 'Shorten the meeting or register more venues.' };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sessions = [];
    for (let i = 0; i < split.plan.length; i++) {
      const s = split.plan[i];
      const id = await insertBooking(client, {
        title: `${title} (session ${i + 1} of ${split.sessions})`,
        description, venueId: s.venue.id, officerId, attendees, start: s.start, end: s.end,
      });
      sessions.push({ id, venue: s.venue.name, start: s.start, end: s.end });
    }
    await client.query('COMMIT');
    return { ok: true, multi: true, sessions };
  } catch (e) {
    await client.query('ROLLBACK');
    if (isClash(e)) return { ok: false, reason: 'A slot was taken while booking.', fix: 'Run the command again.' };
    throw e;
  } finally {
    client.release();
  }
}

async function schedule({ title, description = null, attendees, minutes, start = null, end = null, from = null, officerId = null, venueName = null, split = false }) {
  const base = { title, description, attendees, officerId };

  if (start && end) {
    const r = await findExact({ attendees, start, end, officerId, venueName });
    if (!r.ok) return r.needsSplit && split ? bookSplit({ ...base, split: r.split }) : r;
    return insertOne({ ...base, slot: r });
  }

  let searchFrom = from || new Date();
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await findFlexible({ attendees, minutes, from: searchFrom, officerId, venueName });
    if (!r.ok) return r.needsSplit && split ? bookSplit({ ...base, split: r.split }) : r;
    const res = await insertOne({ ...base, slot: r });
    if (res.retry) { searchFrom = new Date(r.start.getTime() + STEP_MIN * 60000); continue; }
    return res;
  }
  return { ok: false, reason: 'Could not secure a slot.', fix: 'Please try again.' };
}

module.exports = { schedule, findExact, findFlexible };