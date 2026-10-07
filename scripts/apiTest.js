// Runs the whole API from start to finish and prints PASS or FAIL for each check.
// The server must be running first:  npm run server
const pool = require('../db');
const BASE = process.env.API || 'http://localhost:3000/api';

let passed = 0, failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${extra}`); }
};

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

const dayAhead = (min) => {
  const d = new Date();
  d.setDate(d.getDate() + min);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

(async () => {
  const stamp = Date.now();
  const adminEmail = `admin${stamp}@test.local`, userEmail = `user${stamp}@test.local`, otherEmail = `other${stamp}@test.local`;
  const pw = 'password123';
  const created = [];

  console.log('\nAccounts and login');
  check('health check', (await call('GET', '/health')).status === 200);
  check('bad email refused', (await call('POST', '/auth/register', { name: 'A', email: 'nope', password: pw })).status === 400);
  check('short password refused', (await call('POST', '/auth/register', { name: 'A', email: userEmail, password: 'short' })).status === 400);
  const a = await call('POST', '/auth/register', { name: 'Test Admin', email: adminEmail, password: pw });
  check('admin account created', a.status === 201 && a.data.token);
  await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [adminEmail]); // test-only promotion
  const u = await call('POST', '/auth/register', { name: 'Test User', email: userEmail, password: pw });
  const o = await call('POST', '/auth/register', { name: 'Other User', email: otherEmail, password: pw });
  check('normal accounts created as user', u.data.user.role === 'user' && o.data.user.role === 'user');
  check('duplicate email refused', (await call('POST', '/auth/register', { name: 'A', email: userEmail, password: pw })).status === 409);
  check('wrong password refused', (await call('POST', '/auth/login', { email: userEmail, password: 'wrongpass1' })).status === 401);
  const login = await call('POST', '/auth/login', { email: userEmail, password: pw });
  check('login works', login.status === 200 && login.data.token);
  const T = login.data.token, A = (await call('POST', '/auth/login', { email: adminEmail, password: pw })).data.token, O = o.data.token;
  check('no token refused', (await call('GET', '/bookings')).status === 401);
  check('fake token refused', (await call('GET', '/bookings', null, 'abc.def.ghi')).status === 401);

  console.log('\nRooms');
    const priv = await call('POST', '/venues', { name: `Mine ${stamp}`, capacity: 12 }, T);
  const pid = priv.data && priv.data.venue ? priv.data.venue.id : 0;
  check('user can add a room of their own', priv.status === 201, JSON.stringify(priv.data));
  check('other user cannot see that room', !(await call('GET', '/venues', null, O)).data.venues.some((x) => x.name === `Mine ${stamp}`));
  const seen = (await call('GET', '/venues', null, A)).data.venues.find((x) => x.name === `Mine ${stamp}`);
  check('admin sees it, marked private to its owner', seen && seen.private === true && seen.owner === 'Test User', JSON.stringify(seen));
  check('user cannot edit rooms', (await call('PATCH', `/venues/${pid}`, { name: `Mine ${stamp}`, capacity: 15 }, T)).status === 403);
  check('admin can edit any room', (await call('PATCH', `/venues/${pid}`, { name: `Mine ${stamp}`, capacity: 14 }, A)).status === 200);
  const v = await call('POST', '/venues', { name: `Room ${stamp}`, capacity: 12 }, A);
  check('admin adds a room', v.status === 201);
  check('duplicate room refused', (await call('POST', '/venues', { name: `Room ${stamp}`, capacity: 12 }, A)).status === 409);
  check('bad capacity refused', (await call('POST', '/venues', { name: 'X', capacity: -3 }, A)).status === 400);
  const vs = await call('GET', '/venues', null, T);
  check('everyone can list rooms', vs.status === 200 && vs.data.venues.length >= 1);

  console.log('\nBooking');
  const d1 = dayAhead(7), d2 = dayAhead(8);
  const b1 = await call('POST', '/bookings', { title: 'Budget review', about: 'budget review with the finance team', attendees: 12, date: d1 }, T);
  check('booked with no length (AI estimate)', b1.data.ok === true && b1.data.notes.some((n) => n.includes('estimate')), JSON.stringify(b1.data));
  if (b1.data.ok) created.push(b1.data.bookings[0].id);
  const short = await call('POST', '/bookings', { title: 'Budget review', about: 'budget review with the finance team', attendees: 12, minutes: 30, date: d1 }, T);
  check('too-short request explained with options', short.data.ok === false && /too short/.test(short.data.reason) && short.data.options.length >= 1, JSON.stringify(short.data));
  const forced = await call('POST', '/bookings', { title: 'Budget review', about: 'budget review with the finance team', attendees: 12, minutes: 30, date: d1, force: true }, T);
  check('force books it anyway', forced.data.ok === true);
  if (forced.data.ok) created.push(forced.data.bookings[0].id);
  check('missing title refused', (await call('POST', '/bookings', { attendees: 5, minutes: 30 }, T)).status === 400);
  check('bad people count refused', (await call('POST', '/bookings', { title: 'x', attendees: 0, minutes: 30 }, T)).status === 400);
  check('bad time refused', (await call('POST', '/bookings', { title: 'x', attendees: 5, from: '25:99', to: '26:00' }, T)).status === 400);
  const tooMany = await call('POST', '/bookings', { title: 'Town hall', attendees: 5000, minutes: 60 }, T);
  check('too many people explained', tooMany.data.ok === false && tooMany.data.options.length >= 1);
    check('no developer text reaches the user', [...short.data.options, ...tooMany.data.options].every((x) => !/--force|--split|npm run/.test(x)));
  check('end before start refused', (await call('POST', '/bookings', { title: 'x', attendees: 5, date: d1, from: '11:00', to: '10:00' }, T)).status === 400);
  check('meeting shorter than 5 minutes refused', (await call('POST', '/bookings', { title: 'x', attendees: 5, date: d1, from: '09:00', to: '09:03' }, T)).status === 400);
  check('past date refused', (await call('POST', '/bookings', { title: 'x', attendees: 5, date: '2020-01-06', from: '09:00', to: '10:00' }, T)).status === 400);
  const pbk = await call('POST', '/bookings', { title: 'Private room test', attendees: 5, date: d2, from: '16:00', to: '17:00', room: `Mine ${stamp}`, force: true }, T);
  check('user can book their own room', pbk.data.ok === true, JSON.stringify(pbk.data));
  if (pbk.data.ok) created.push(pbk.data.bookings[0].id);
  const nope = await call('POST', '/bookings', { title: 'Private room test', attendees: 5, date: d2, from: '16:00', to: '17:00', room: `Mine ${stamp}`, force: true }, O);
  check('another user cannot book that room', nope.data.ok === false, JSON.stringify(nope.data));

  console.log('\nVisibility');
  const mine = await call('GET', '/bookings', null, T);
  check('user sees their meetings', mine.data.bookings.length >= 2);
  const others = await call('GET', '/bookings', null, O);
  check('another user sees none of them', others.data.bookings.every((b) => !created.includes(b.id)));
  const all = await call('GET', '/bookings', null, A);
  check('admin sees everyone\'s meetings', created.every((id) => all.data.bookings.some((b) => b.id === id)));
  check('other user cannot cancel it', (await call('POST', `/bookings/${created[0]}/cancel`, null, O)).status === 403);

  console.log('\nReschedule');
  const A1 = await call('POST', '/bookings', { title: 'Audit', about: 'audit meeting with the internal audit unit', attendees: 5, date: d2, from: '09:00', to: '11:00', room: `Room ${stamp}` }, T);
  check('exact-time booking', A1.data.ok === true, JSON.stringify(A1.data));
  const idA = A1.data.bookings[0].id; created.push(idA);
  const B1 = await call('POST', '/bookings', { title: 'Planning', about: 'strategic planning workshop', attendees: 5, date: d2, from: '13:00', to: '15:00', room: `Room ${stamp}`, force: true }, O);
  const idB = B1.data.bookings[0].id; created.push(idB);
  const move = await call('POST', `/bookings/${idA}/reschedule`, { date: d2, from: '09:30', to: '11:30' }, T);
  check('moves by 30 minutes, overlapping its own old slot', move.data.ok === true, JSON.stringify(move.data));
  if (move.data.ok) created.push(move.data.bookings[0].id);
  const idA2 = move.data.ok ? move.data.bookings[0].id : idA;
  const clash = await call('POST', `/bookings/${idA2}/reschedule`, { date: d2, from: '13:30', to: '14:30', room: `Room ${stamp}` }, T);
  check('refuses a clashing move and explains', clash.data.ok === false && clash.data.options.length >= 1 && clash.data.kept, JSON.stringify(clash.data));
  const after = await call('GET', '/bookings', null, T);
  check('original stays booked after a refused move', after.data.bookings.find((b) => b.id === idA2)?.status === 'scheduled');
  check('old slot was released after a successful move', after.data.bookings.find((b) => b.id === idA)?.status === 'cancelled');

  console.log('\nCancel');
  check('cancel works', (await call('POST', `/bookings/${idB}/cancel`, null, O)).data.ok === true);
  check('cancel twice refused', (await call('POST', `/bookings/${idB}/cancel`, null, O)).status === 400);

  console.log('\nFeedback');
  check('feedback on a future meeting refused', (await call('POST', `/bookings/${idA2}/feedback`, { text: 'It lasted 60 minutes and 5 people came' }, T)).status === 400);
  const { rows: vr } = await pool.query('SELECT id FROM venues ORDER BY id LIMIT 1');
  const { rows: ur } = await pool.query('SELECT id FROM users WHERE email = $1', [userEmail]);
  const past = new Date(Date.now() - 3 * 86400000); past.setHours(14, 0, 0, 0);
  const { rows: pb } = await pool.query(
    `INSERT INTO bookings (title, description, venue_id, expected_attendees, start_time, end_time, predicted_minutes, created_by)
     VALUES ('Budget review', 'budget review with the finance team', $1, 12, $2, $3, 65, $4) RETURNING id`,
    [vr[0].id, past, new Date(past.getTime() + 3600000), ur[0].id]
  );
  created.push(pb[0].id);
  const unclear = await call('POST', `/bookings/${pb[0].id}/feedback`, { text: 'it went fine' }, T);
  check('unclear feedback asks again', unclear.status === 400);
  const fb = await call('POST', `/bookings/${pb[0].id}/feedback`, { text: 'It lasted 95 minutes and 10 people came' }, T);
  check('feedback understood and saved', fb.data.ok === true && fb.data.understood.minutes === 95 && fb.data.understood.attendees === 10, JSON.stringify(fb.data));
  check('feedback twice refused', (await call('POST', `/bookings/${pb[0].id}/feedback`, { text: '95 minutes and 10 people' }, T)).status === 400);

  console.log('\nDashboard and AI');
  const sum = await call('GET', '/summary', null, T);
  check('summary numbers', sum.status === 200 && sum.data.upcoming >= 1 && sum.data.completed >= 1, JSON.stringify(sum.data));
  const m = await call('GET', '/model', null, T);
  check('model status', m.status === 200 && m.data.active && m.data.versions.length >= 1);
  check('training data is admin only', (await call('GET', '/training-data', null, T)).status === 403);
  const td = await call('GET', '/training-data?limit=5', null, A);
  check('admin reads training data, with no internal labels', td.status === 200 && td.data.rows.length === 5 && !('source' in td.data.rows[0]));
  check('user cannot retrain', (await call('POST', '/model/retrain', null, T)).status === 403);
  const rt = await call('POST', '/model/retrain', null, A);
  check('admin starts retraining', rt.data.started === true);
  const rt2 = await call('POST', '/model/retrain', null, A);
  check('a second retrain is refused while one is running', rt2.data.started === false);
  const t0 = Date.now();
  let busy = true;
  while (busy && Date.now() - t0 < 150000) {
    const h = await call('GET', '/health');          // server must keep answering while training
    if (h.status !== 200) break;
    busy = (await call('GET', '/model', null, T)).data.training;
    if (busy) await new Promise((r) => setTimeout(r, 3000));
  }
  check('server stayed responsive and training finished', !busy);

  console.log('\nRoles');
  const uid = (await pool.query('SELECT id FROM users WHERE email = $1', [otherEmail])).rows[0].id;
  check('admin promotes a user', (await call('PATCH', `/users/${uid}/role`, { role: 'admin' }, A)).data.user.role === 'admin');
  check('user cannot list users', (await call('GET', '/users', null, T)).status === 403);

  // clean up everything this test created
  await pool.query('DELETE FROM reminders WHERE booking_id = ANY($1)', [created]);
  await pool.query('DELETE FROM training_examples WHERE booking_id = ANY($1)', [created]);
  await pool.query('DELETE FROM feedback WHERE booking_id = ANY($1)', [created]);
  await pool.query('DELETE FROM bookings WHERE id = ANY($1)', [created]);
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [[adminEmail, userEmail, otherEmail]]);
    await pool.query('DELETE FROM venues WHERE name = ANY($1)', [[`Room ${stamp}`, `Mine ${stamp}`]]);

  console.log(`\n${passed} passed, ${failed} failed.`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('Test crashed:', e); await pool.end(); process.exit(1); });