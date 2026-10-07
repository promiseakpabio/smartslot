const express = require('express');
const pool = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { startRetrain, isTraining, trainingSince } = require('../ai/retrainJob');

const router = express.Router();
router.use(requireAuth);

// Rooms
router.get('/venues', async (req, res) => {
  const admin = req.user.role === 'admin';
  const { rows } = await pool.query(
    `SELECT v.id, v.name, v.capacity, v.created_by, u.name AS owner_name
     FROM venues v LEFT JOIN users u ON u.id = v.created_by
     WHERE $1::boolean OR v.created_by IS NULL OR v.created_by = $2
     ORDER BY v.capacity, v.name`,
    [admin, req.user.id]
  );
  res.json({
    venues: rows.map((v) => ({ id: v.id, name: v.name, capacity: v.capacity, private: v.created_by !== null, owner: admin ? v.owner_name : null })),
  });
});

router.post('/venues', async (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  const capacity = Number((req.body || {}).capacity);
  if (!name || name.length > 80) return res.status(400).json({ error: 'Please give the room a name.' });
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) return res.status(400).json({ error: 'Capacity must be a whole number of at least 1.' });
  try {
    // rooms an admin adds are shared with everyone; rooms a normal user adds belong to that user
    const owner = req.user.role === 'admin' ? null : req.user.id;
    const { rows } = await pool.query('INSERT INTO venues (name, capacity, created_by) VALUES ($1, $2, $3) RETURNING id, name, capacity', [name, capacity, owner]);
    res.status(201).json({ venue: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A room with that name already exists.' });
    throw e;
  }
});

router.patch('/venues/:id', requireAdmin, async (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  const capacity = Number((req.body || {}).capacity);
  if (!name || name.length > 80) return res.status(400).json({ error: 'Please give the room a name.' });
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) return res.status(400).json({ error: 'Capacity must be a whole number of at least 1.' });
  try {
    const { rows } = await pool.query('UPDATE venues SET name = $1, capacity = $2 WHERE id = $3 RETURNING id, name, capacity', [name, capacity, Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'No such room.' });
    res.json({ venue: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A room with that name already exists.' });
    throw e;
  }
});

// Users (admin)
router.get('/users', requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, email, role, created_at FROM users ORDER BY id');
  res.json({ users: rows });
});

router.patch('/users/:id/role', requireAdmin, async (req, res) => {
  const role = (req.body || {}).role;
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Role must be admin or user.' });
  if (Number(req.params.id) === req.user.id && role !== 'admin') return res.status(400).json({ error: 'You cannot remove your own admin rights.' });
  const { rows } = await pool.query('UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, email, role', [role, Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'No such user.' });
  res.json({ user: rows[0] });
});

// Home screen numbers
router.get('/summary', async (req, res) => {
  const own = req.user.role === 'admin' ? '' : 'AND b.created_by = $3';
  const params = [new Date(new Date().setHours(0, 0, 0, 0)), new Date(new Date().setHours(24, 0, 0, 0))];
  if (own) params.push(req.user.id);
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE b.status = 'scheduled' AND b.start_time >= $1 AND b.start_time < $2)::int AS today,
       COUNT(*) FILTER (WHERE b.status = 'scheduled' AND b.start_time >= now())::int AS upcoming,
       COUNT(*) FILTER (WHERE b.status = 'completed')::int AS completed,
       COUNT(*) FILTER (WHERE b.status = 'cancelled')::int AS cancelled,
       COUNT(*) FILTER (WHERE b.status = 'scheduled' AND b.end_time < now())::int AS awaiting_feedback,
       ROUND(AVG(ABS(b.predicted_minutes - f.actual_minutes)) FILTER (WHERE f.id IS NOT NULL AND b.predicted_minutes IS NOT NULL), 1) AS avg_prediction_error,
       ROUND(100 * AVG(f.actual_attendees::numeric / NULLIF(b.expected_attendees, 0)) FILTER (WHERE f.id IS NOT NULL), 0) AS attendance_rate
     FROM bookings b LEFT JOIN feedback f ON f.booking_id = b.id
     WHERE 1 = 1 ${own}`,
    params
  );
  const { rows: v } = await pool.query('SELECT COUNT(*)::int AS n FROM venues');
  res.json({ ...rows[0], venues: v[0].n });
});

// The AI: model status, history, training data
router.get('/model', async (req, res) => {
  const { rows: versions } = await pool.query(
    `SELECT version, trained_at, n_train, n_test, n_feedback, mae, rmse, baseline_mae, guess_mae, office_mae, n_office_test, note, is_active
     FROM model_registry ORDER BY version`
  );
  const { rows: c } = await pool.query('SELECT COUNT(*)::int AS n FROM training_examples');
  res.json({
    active: versions.find((v) => v.is_active) || null,
    versions,
    trainingExamples: c[0].n,
    training: isTraining(),
    trainingSince: trainingSince(),
  });
});

router.post('/model/retrain', requireAdmin, (req, res) => {
  res.json(startRetrain());
});

router.get('/training-data', requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { rows } = await pool.query(
    `SELECT id, description, attendees, scheduled_minutes, actual_minutes
     FROM training_examples ORDER BY id DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const { rows: c } = await pool.query('SELECT COUNT(*)::int AS n FROM training_examples');
  res.json({ total: c[0].n, rows });
});

module.exports = router;
