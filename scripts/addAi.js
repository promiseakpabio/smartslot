const fs = require('fs');
const path = require('path');
const pool = require('../db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../db/ai.sql'), 'utf8');
  await pool.query(sql);
  console.log('AI tables ready (training_examples, model_registry).');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });