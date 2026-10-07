const pool = require('../db');
const model = require('./durationModel');

let cache = null; // remembers the loaded model so we do not rebuild it every time

// Load the model that is marked active in model_registry (null if none trained yet)
async function getActiveModel() {
  const { rows } = await pool.query(
    'SELECT id, version, model_json FROM model_registry WHERE is_active = true ORDER BY id DESC LIMIT 1'
  );
  if (rows.length === 0) return null;
  if (!cache || cache.id !== rows[0].id) {
    cache = { id: rows[0].id, version: rows[0].version, loaded: model.load(rows[0].model_json) };
  }
  return cache;
}

// How many minutes will this meeting really take?
function predictWith(active, description, attendees) {
  return model.predictOne(active.loaded, { description, attendees });
}

module.exports = { getActiveModel, predictWith };