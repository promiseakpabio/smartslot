const { RandomForestRegression } = require('ml-random-forest');
const { buildVocab, vectorize } = require('./features');

function train(rows) {
  const vocab = buildVocab(rows.map((r) => r.description));
  const X = rows.map((r) => vectorize(r, vocab));
  const y = rows.map((r) => r.actual_minutes);
  const forest = new RandomForestRegression({
    nEstimators: 25,
    seed: 42,
    maxFeatures: 0.5,
    replacement: true,
  });
  forest.train(X, y);
  return { forest: forest.toJSON(), vocab };
}

function load(saved) {
  return { forest: RandomForestRegression.load(saved.forest), vocab: saved.vocab };
}

function predictMany(loaded, rows) {
  const X = rows.map((r) => vectorize(r, loaded.vocab));
  return loaded.forest.predict(X);
}

function predictOne(loaded, row) {
  return Math.max(10, Math.round(predictMany(loaded, [row])[0] / 5) * 5);
}

// Average error in minutes (MAE) and root mean squared error (RMSE)
function errors(predicted, actual) {
  let abs = 0, sq = 0;
  predicted.forEach((p, i) => { const e = p - actual[i]; abs += Math.abs(e); sq += e * e; });
  return { mae: abs / actual.length, rmse: Math.sqrt(sq / actual.length) };
}

module.exports = { train, load, predictMany, predictOne, errors };