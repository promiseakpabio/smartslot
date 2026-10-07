// Meetings are scheduled in office hours, so the server must use the office's time zone
if (!process.env.TZ) process.env.TZ = 'Africa/Lagos';
require('dotenv').config();

const path = require('path');

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const pool = require('./db');
const { sendDue } = require('./reminders');
const { router: authRouter } = require('./api/auth');
const bookingsRouter = require('./api/bookings');
const adminRouter = require('./api/admin');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname,'www')));

app.get('/api/health', async (req, res) => {
  const { rows } = await pool.query('SELECT now() AS database_time');
  res.json({ status: 'ok', databaseTime: rows[0].database_time });
});

app.use('/api/auth', authRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api', adminRouter);

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// Last safety net: never leak internal details to the app
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`SmartSlot server running on port ${PORT}`);
  // the reminder worker lives inside the server, so there is only one thing to run
  if (process.env.RUN_WORKER !== 'false') {
    cron.schedule('* * * * *', () => sendDue().catch(console.error));
    console.log('Reminder worker started (checks every minute).');
  }
});