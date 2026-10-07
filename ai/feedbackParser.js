// Reads a sentence like "It lasted 55 minutes and 10 people came"
// and pulls out the actual length (minutes) and the actual attendance.

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50 };

function normalize(text) {
  let t = String(text).toLowerCase().replace(/,/g, ' ');
  t = t.replace(/\b(?:an?|one) hour and (?:a )?half\b/g, '1.5 hours');
  t = t.replace(/\b(?:half an hour|half hour|a half hour)\b/g, '0.5 hours');
  t = t.replace(/\b(?:an|a) hour\b/g, '1 hour');
  t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty)\b/g, (w) => String(WORDS[w]));
  return t;
}

function parseFeedback(text) {
  const t = normalize(text);

  let minutes = null;
  const h = t.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  const m = t.match(/(\d+)\s*(?:minutes?|mins?|m)\b/);
  if (h) minutes = (minutes || 0) + Math.round(parseFloat(h[1]) * 60);
  if (m) minutes = (minutes || 0) + parseInt(m[1], 10);

  let attendees = null;
  const patterns = [
    /(\d+)\s*(?:people|persons|person|attendees|participants|staff|officers|members|guests|colleagues)/,
    /(\d+)\s*(?:came|attended|showed up|turned up|were present|were there|present)/,
    /(?:attended|came|attendance(?: was)?|turnout(?: was)?|only)\s*[:\-]?\s*(\d+)(?!\s*(?:min|hour|hr|h\b))/,
  ];
  for (const p of patterns) {
    const hit = t.match(p);
    if (hit) { attendees = parseInt(hit[1], 10); break; }
  }
  return { minutes, attendees };
}

module.exports = { parseFeedback };