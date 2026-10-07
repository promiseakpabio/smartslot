const pool = require('../db');
const { trainAndRegister } = require('../ai/trainer');

(async () => {
  console.log('Training... (this can take up to a minute)');
  const r = await trainAndRegister();
  if (!r.ok) {
    console.log(r.reason);
    return pool.end();
  }
  console.log(`\nModel v${r.version}: ${r.note}`);
  console.log(`Trained on ${r.nTrain} meetings (${r.nFeedback} from the office's own feedback), tested on ${r.nTest} it never saw.`);
  console.log('Average error in minutes (lower is better):');
  console.log(`  Always guess the average length : ${r.baseline.mae.toFixed(1)}`);
  console.log(`  What people typed when booking  : ${r.guess.mae.toFixed(1)}`);
  if (r.old) console.log(`  Previous model (v${r.oldVersion})            : ${r.old.mae.toFixed(1)}`);
  console.log(`  This model (v${r.version})                 : ${r.mine.mae.toFixed(1)}`);
  if (r.oldOffice && r.newOffice) {
    console.log(`\nOn the office's own meetings (${r.officeTestCount} unseen): previous ${r.oldOffice.mae.toFixed(1)} min error, new ${r.newOffice.mae.toFixed(1)} min error.`);
  }
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });