const { Command } = require('commander');
const { smartSchedule } = require('../smart');
const pool = require('../db');

const toDate = (dateStr, timeStr) => {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
};
const todayStr = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

const program = new Command();
program
  .argument('<title>', 'meeting title')
  .argument('<people>', 'number of people')
  .argument('[minutes]', 'length in minutes (optional: SmartSlot can estimate it)')
  .option('--about <text>', 'a short description of the meeting')
  .option('--room <name>', 'a specific room')
  .option('--date <YYYY-MM-DD>', 'the date')
  .option('--from <HH:MM>', 'exact start time')
  .option('--to <HH:MM>', 'exact end time')
  .option('--split', 'book a long meeting as several sessions')
  .option('--force', 'book even if SmartSlot thinks the time is too short')
  .action(async (title, people, minutes, opts) => {
    const attendees = Number(people);
    if (!Number.isInteger(attendees) || attendees < 1) return console.log('People must be a whole number.');

    let start = null, end = null, from = null;
    const mins = minutes ? Number(minutes) : null;

    if (opts.from || opts.to) {
      if (!(opts.from && opts.to)) return console.log('Give both --from and --to.');
      const date = opts.date || todayStr();
      start = toDate(date, opts.from);
      end = toDate(date, opts.to);
    } else if (opts.date) {
      from = new Date(Math.max(toDate(opts.date, '00:00'), new Date()));
    }

    const r = await smartSchedule({
      title, about: opts.about || null, attendees, minutes: mins,
      start, end, from, venueName: opts.room || null,
      split: Boolean(opts.split), force: Boolean(opts.force),
    });

    console.log('');
    if (r.ok && r.multi) {
      console.log(`BOOKED ${r.sessions.length} sessions:`);
      r.sessions.forEach((s, i) => console.log(`  ${i + 1}. #${s.id} ${s.venue}, ${s.start.toLocaleString()} to ${s.end.toLocaleTimeString()}`));
    } else if (r.ok) {
      console.log(`BOOKED #${r.bookingId}: ${r.venue}, ${r.start.toLocaleString()} to ${r.end.toLocaleTimeString()}`);
      if (r.note) console.log(`Note: ${r.note}`);
    } else {
      console.log('NOT BOOKED');
      console.log(`Why: ${r.reason}`);
      if (r.fix) console.log(`What you can do: ${r.fix}`);
    }
    (r.notes || []).forEach((n) => console.log(n));
    console.log('');
  });

program.parseAsync(process.argv).finally(() => pool.end());