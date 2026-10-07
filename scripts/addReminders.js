const fs = require('fs');
const path = require('path');
const pool = require('../db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../db/reminders.sql'), 'utf8');
  await pool.query(sql);
  console.log('Reminders table ready.');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });