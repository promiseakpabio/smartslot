const cron = require('node-cron');
const { sendDue } = require('../reminders');

console.log('SmartSlot reminder worker running. It checks every minute. Press Ctrl+C to stop.');
sendDue().catch(console.error);
cron.schedule('* * * * *', () => sendDue().catch(console.error));