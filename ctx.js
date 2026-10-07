// Remembers which user a booking request is for, so the scheduler only picks rooms that user may use.
const { AsyncLocalStorage } = require('async_hooks');
const store = new AsyncLocalStorage();

module.exports = {
  runAs: (userId, fn) => store.run({ userId }, fn),
  currentUser: () => (store.getStore() || {}).userId || null,
};
