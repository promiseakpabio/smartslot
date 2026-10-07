const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();

const secret = () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is missing in your .env file');
  return process.env.JWT_SECRET;
};
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const sign = (u) => jwt.sign({ id: u.id }, secret(), { expiresIn: '12h' });

// Very small brake on password guessing: 10 failed tries per email per 15 minutes
const failures = new Map();
const tooMany = (key) => {
  const now = Date.now();
  const recent = (failures.get(key) || []).filter((t) => now - t < 15 * 60000);
  failures.set(key, recent);
  return recent.length >= 10;
};
const noteFailure = (key) => failures.set(key, [...(failures.get(key) || []), Date.now()]);

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in.' });
  let payload;
  try {
    payload = jwt.verify(token, secret());
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
  const { rows } = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [payload.id]);
  if (rows.length === 0) return res.status(401).json({ error: 'That account no longer exists.' });
  req.user = rows[0];
  next();
}

const requireAdmin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Only an admin can do that.' });

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Please enter your name.' });
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'The password must be at least 8 characters.' });

  const clean = String(email).trim().toLowerCase();
  const taken = await pool.query('SELECT 1 FROM users WHERE email = $1', [clean]);
  if (taken.rowCount) return res.status(409).json({ error: 'An account with that email already exists.' });

  // the very first account becomes the admin
  const { rows: c } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  const role = c[0].n === 0 ? 'admin' : 'user';
  const hash = await bcrypt.hash(String(password), 10);
  const { rows } = await pool.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
    [String(name).trim(), clean, hash, role]
  );
  res.status(201).json({ token: sign(rows[0]), user: publicUser(rows[0]) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const clean = String(email || '').trim().toLowerCase();
  if (tooMany(clean)) return res.status(429).json({ error: 'Too many failed attempts. Please wait 15 minutes and try again.' });

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [clean]);
  const ok = rows.length > 0 && (await bcrypt.compare(String(password || ''), rows[0].password_hash));
  if (!ok) {
    noteFailure(clean);
    return res.status(401).json({ error: 'Wrong email or password.' });
  }
  res.json({ token: sign(rows[0]), user: publicUser(rows[0]) });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

module.exports = { router, requireAuth, requireAdmin };