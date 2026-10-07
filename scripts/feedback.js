const { Command } = require('commander');
const { parseFeedback } = require('../ai/feedbackParser');
const { recordFeedback } = require('../feedback');
const pool = require('../db');

const program = new Command();
program
  .argument('<bookingId>', 'the meeting number')
  .argument('[words...]', 'say what happened, e.g. It lasted 55 minutes and 10 people came')
  .option('--minutes <n>', 'actual length in minutes')
  .option('--people <n>', 'how many people actually came')
  .action(async (bookingId, words, opts) => {
    const text = (words || []).join(' ');
    const parsed = text ? parseFeedback(text) : { minutes: null, attendees: null };
    const minutes = opts.minutes ? Number(opts.minutes) : parsed.minutes;
    const attendees = opts.people ? Number(opts.people) : parsed.attendees;

    console.log('');
    if (text) console.log(`I understood: length = ${minutes ?? '?'} minutes, attendance = ${attendees ?? '?'} people.`);
    if (!minutes || attendees == null) {
      console.log('I could not find both numbers. Please say how long it lasted and how many people came,');
      console.log('for example: It lasted 55 minutes and 10 people came.');
      console.log('');
      return;
    }

    try {
      const r = await recordFeedback({ bookingId: Number(bookingId), minutes, attendees, comment: text || null });
      console.log(`Thank you. Feedback saved for "${r.title}".`);
      console.log(`  Booked: ${r.scheduled} min | SmartSlot predicted: ${r.predicted ?? 'n/a'} min | Actual: ${r.actual} min`);
      console.log(`  Expected ${r.expected} people | Came: ${r.attended}`);
      if (r.retrain) {
        const t = r.retrain;
        console.log(`\nSmartSlot retrained itself on the new feedback. ${t.note}`);
      } else {
        console.log(`  ${r.newSinceTraining} of ${r.retrainAfter} feedback entries collected before the next automatic retrain.`);
      }
    } catch (e) {
      console.log(e.message);
    }
    console.log('');
  });

program.parseAsync(process.argv).finally(() => pool.end());