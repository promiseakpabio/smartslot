// Simulated meeting history. NOT real ministry data.
// Each type has a base length, extra minutes per person, and ways people describe it.
const TYPES = [
  { base: 25, per: 3.0, size: [2, 25], texts: ['budget review with the finance team', 'quarterly budget review and expenditure check', 'review of the departmental budget allocation', 'budget meeting on spending and releases'] },
  { base: 20, per: 1.0, size: [5, 40], texts: ['staff briefing on weekly activities', 'morning staff briefing and announcements', 'general staff meeting on office updates', 'briefing for all staff on new directives'] },
  { base: 40, per: 4.0, size: [2, 18], texts: ['audit meeting with the internal audit unit', 'audit query response and documents review', 'meeting with auditors on pending queries', 'audit exit meeting on findings'] },
  { base: 30, per: 3.5, size: [3, 30], texts: ['project kickoff meeting for the new digital project', 'commencement meeting for the approved project', 'kickoff with the contractor and project team', 'project launch planning with stakeholders'] },
  { base: 45, per: 2.0, size: [5, 45], texts: ['training session on the new records system', 'staff training workshop on digital tools', 'capacity building session for officers', 'hands-on training for the ICT unit'] },
  { base: 20, per: 8.0, size: [1, 4], texts: ['interview for the vacant officer position', 'panel interview of shortlisted candidates', 'recruitment interview for the ICT role', 'interview with the applicant'] },
  { base: 15, per: 6.0, size: [1, 5], texts: ['client consultation on service application', 'meeting with a client on a pending request', 'public enquiry and service consultation', 'consultation with a visitor on registration'] },
  { base: 35, per: 5.0, size: [3, 10], texts: ['complaint hearing with the affected parties', 'hearing on a staff complaint', 'grievance meeting and resolution', 'complaint review with the committee'] },
  { base: 50, per: 2.5, size: [3, 25], texts: ['strategic planning workshop for next year', 'planning session on the annual work plan', 'policy planning meeting with directors', 'workshop on the departmental strategy'] },
  { base: 15, per: 1.2, size: [2, 8], texts: ['routine check in with the unit head', 'weekly progress check in', 'short update meeting with the team', 'regular coordination meeting'] },
];
const SHORT = ['brief', 'quick', 'short', 'short'];
const LONG = ['detailed', 'full', 'comprehensive', 'annual', 'extended'];
const URGENT = ['urgent', 'immediate', 'deadline tomorrow', 'emergency', 'priority'];

// small seeded random generator so the dataset is the same every time
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const round = (x, step) => Math.round(x / step) * step;

function generate(n = 600, seed = 7, slow = 1) {
  const rand = rng(seed);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const normal = () => (rand() + rand() + rand() + rand() - 2) / 0.58; // roughly mean 0, sd 1
  const rows = [];
  for (let i = 0; i < n; i++) {
    const t = pick(TYPES);
    const attendees = t.size[0] + Math.floor(rand() * (t.size[1] - t.size[0] + 1));
    let text = pick(t.texts);
    let factor = 1;
    const r = rand();
    if (r < 0.2) { text = `${pick(SHORT)} ${text}`; factor = 0.6; }
    else if (r < 0.4) { text = `${pick(LONG)} ${text}`; factor = 1.5; }
    if (rand() < 0.15) text = `${pick(URGENT)} ${text}`;
    const actual = Math.max(10, round((t.base + t.per * attendees) * factor * slow * (1 + 0.12 * normal()), 5));
    const guess = rand() < 0.7 ? 60 : pick([30, 45, 90]); // people tend to book an hour for everything
    rows.push({ description: text, attendees, scheduled_minutes: guess, actual_minutes: actual });
  }
  return rows;
}

module.exports = { generate };