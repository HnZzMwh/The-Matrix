const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createEmptySession,
  ensureSessionAgent,
  deriveSessionTitle,
  getLatestSessionTimestamp,
  shouldAutoSaveSession,
  normalizeSavedSession,
  migrateLegacyRuntimeChats,
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

test('shouldAutoSaveSession requires both dirty and non-empty', () => {
  const empty = createEmptySession({ id: 'sess_empty', currentAgentId: 'architect' });
  assert.equal(shouldAutoSaveSession(empty), false);

  const dirty = createEmptySession({ id: 'sess_dirty', currentAgentId: 'architect' });
  dirty.dirty = true;
  ensureSessionAgent(dirty, { id: 'architect', name: 'ARCHITECT' }).messages.push({ role: 'user', text: 'hi', time: 1 });
  assert.equal(shouldAutoSaveSession(dirty), true);
});

test('normalizeSavedSession wraps legacy single-agent records', () => {
  const legacy = {
    id: 'sess_legacy',
    agentId: 'architect',
    agentName: 'ARCHITECT',
    title: 'LEGACY',
    messages: [{ role: 'user', text: 'hello', time: 5 }],
    savedAt: 5,
  };
  const normalized = normalizeSavedSession(legacy);
  assert.equal(normalized.agents.architect.agentName, 'ARCHITECT');
  assert.equal(normalized.agents.architect.messages.length, 1);
});

test('migrateLegacyRuntimeChats folds per-agent chat blobs into one session', () => {
  const migrated = migrateLegacyRuntimeChats(
    {
      architect: [{ role: 'user', text: 'a', time: 10 }],
      debugger: [{ role: 'assistant', text: 'b', time: 15 }],
    },
    [{ id: 'architect', name: 'ARCHITECT' }, { id: 'debugger', name: 'DEBUGGER' }],
    'architect'
  );
  assert.equal(migrated.lastActiveAgentId, 'architect');
  assert.equal(migrated.agents.debugger.messages[0].text, 'b');
});
