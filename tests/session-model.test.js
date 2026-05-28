const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createEmptySession,
  ensureSessionAgent,
  deriveSessionTitle,
  getLatestSessionTimestamp,
} = require('../renderer/js/session-model.js');

test('createEmptySession seeds an empty multi-agent session', () => {
  const session = createEmptySession({ id: 'sess_1', currentAgentId: 'architect' });
  assert.equal(session.id, 'sess_1');
  assert.equal(session.lastActiveAgentId, 'architect');
  assert.deepEqual(session.agents, {});
  assert.equal(session.dirty, false);
});

test('deriveSessionTitle uses the first user message and trims it', () => {
  const title = deriveSessionTitle('  fix save to include all agents when restoring  ');
  assert.equal(title, 'FIX SAVE TO INCLUDE ALL AGE...');
});

test('ensureSessionAgent creates a stable agent bucket', () => {
  const session = createEmptySession({ id: 'sess_2', currentAgentId: 'architect' });
  const bucket = ensureSessionAgent(session, { id: 'debugger', name: 'DEBUGGER' });
  assert.equal(bucket.agentId, 'debugger');
  assert.equal(bucket.agentName, 'DEBUGGER');
  assert.deepEqual(bucket.messages, []);
});

test('getLatestSessionTimestamp returns the newest message time across agents', () => {
  const session = createEmptySession({ id: 'sess_3', currentAgentId: 'architect' });
  ensureSessionAgent(session, { id: 'architect', name: 'ARCHITECT' }).messages.push({ time: 10, text: 'a' });
  ensureSessionAgent(session, { id: 'debugger', name: 'DEBUGGER' }).messages.push({ time: 25, text: 'b' });
  assert.equal(getLatestSessionTimestamp(session), 25);
});
