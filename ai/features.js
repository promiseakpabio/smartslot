const { WordTokenizer } = require('natural');
const tokenizer = new WordTokenizer();

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'for', 'with', 'on', 'in', 'at', 'by', 'our', 'we', 'is', 'are', 'this', 'that', 'it', 'its', 'from', 'be', 'will', 'about']);

// Turn a sentence into a list of useful lowercase words
function tokenize(text) {
  return tokenizer.tokenize(String(text).toLowerCase()).filter((w) => w.length > 1 && !STOP.has(w));
}

// Learn the vocabulary and word importance (IDF) from the training sentences only
function buildVocab(texts, minDocs = 8) {
  const df = {};
  for (const t of texts) for (const w of new Set(tokenize(t))) df[w] = (df[w] || 0) + 1;
  const words = Object.keys(df).filter((w) => df[w] >= minDocs).sort();
  const idf = words.map((w) => Math.log(texts.length / (1 + df[w])) + 1);
  return { words, idf };
}

// One row of numbers: [attendees (repeated), tf-idf of each vocabulary word]
function vectorize({ description, attendees }, vocab) {
  const tokens = tokenize(description);
  const counts = {};
  for (const w of tokens) counts[w] = (counts[w] || 0) + 1;
  // the number of people is the strongest signal, so it is given several columns
  // (this makes the forest consider it in almost every split)
  const n = Number(attendees);
  const row = [n, n, n, n, n, n];
  vocab.words.forEach((w, i) => {
    row.push(counts[w] ? (counts[w] / Math.max(tokens.length, 1)) * vocab.idf[i] : 0);
  });
  return row;
}

module.exports = { tokenize, buildVocab, vectorize };