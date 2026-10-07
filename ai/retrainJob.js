const { spawn } = require('child_process');
const path = require('path');

// Training is heavy, so it runs in a separate process. The API keeps answering while it works.
let child = null;
let startedAt = null;

function startRetrain() {
  if (child) return { started: false, reason: 'Training is already running.' };
  child = spawn(process.execPath, [path.join(__dirname, '../scripts/train.js')], { stdio: 'ignore' });
  startedAt = new Date();
  child.on('exit', () => { child = null; });
  child.on('error', () => { child = null; });
  return { started: true };
}

const isTraining = () => child !== null;
const trainingSince = () => (child ? startedAt : null);

module.exports = { startRetrain, isTraining, trainingSince };