const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
function current() {
  const value = context.getStore();
  if (!value?.workspaceId) throw new Error('Workspace context is required');
  return value;
}
function run(workspaceId, fn, extra = {}) {
  return context.run({ ...extra, workspaceId }, fn);
}
module.exports = { current, run };
