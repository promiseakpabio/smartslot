const fs = require('fs');
const path = require('path');
const pool = require('../db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  await pool.query(sql);

  await pool.query(`
    INSERT INTO venues (name, capacity) VALUES
      ('Conference Room A', 10),
      ('Conference Hall B', 20),
      ('Boardroom', 15),
      ('Training Room', 40)
  `);
  await pool.query(`
    INSERT INTO officers (name, department) VALUES
      ('Officer Adeyemi', 'Planning'),
      ('Officer Bello', 'Finance'),
      ('Officer Okafor', 'ICT')
  `);

  console.log('Database ready.');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });