const fs = require('fs');
const path = require('path');
const pool = require('../db');

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.log('Usage: node scripts/runSql.js db/file.sql');
    return pool.end();
  }
  await pool.query(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  console.log(`Done: ${file}`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });