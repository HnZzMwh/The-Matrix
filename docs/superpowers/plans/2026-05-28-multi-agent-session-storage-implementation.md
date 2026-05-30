# Multi-Agent Session Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-agent runtime chat persistence with a session-centric model where one active session contains all agent conversations, `SAVE` stores the whole session, and restoring a saved session auto-saves the current dirty session first.

**Architecture:** Add a small pure helper layer for session shaping and migration rules, then route the existing browser globals through session-backed accessors so most chat UI code stays intact. Keep rendering agent-centric, but change persistence and runtime state to `currentSession -> agents[agentId].messages`, with compatibility wrappers for legacy per-agent saved data.

**Tech Stack:** Electron, plain browser JavaScript, localStorage, Electron IPC store, Node built-in test runner

---

### Task 1: Add Pure Session Model Helpers

**Files:**
- Create: `e:\programs\matrix\renderer\js\session-model.js`
- Create: `e:\programs\matrix\tests\session-model.test.js`
- Modify: `e:\programs\matrix\renderer\matrix-upload.html`
- Modify: `e:\programs\matrix\package.json`

- [ ] **Step 1: Write the failing tests for session creation and timestamps**

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test tests/session-model.test.js
```

Expected: FAIL with `Cannot find module '../renderer/js/session-model.js'`

- [ ] **Step 3: Implement the minimal session helper module**

```js
function createEmptySession({ id, currentAgentId, now = Date.now() }) {
  return {
    id,
    title: 'SESSION_' + now,
    createdAt: now,
    savedAt: 0,
    lastActiveAgentId: currentAgentId || null,
    dirty: false,
    agents: {},
  };
}

function deriveSessionTitle(text) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ').toUpperCase();
  if (!clean) return 'SESSION_' + Date.now();
  return clean.length > 30 ? clean.slice(0, 30) + '...' : clean;
}

function ensureSessionAgent(session, agent) {
  if (!session.agents[agent.id]) {
    session.agents[agent.id] = {
      agentId: agent.id,
      agentName: agent.name,
      messages: [],
    };
  }
  return session.agents[agent.id];
}

function getLatestSessionTimestamp(session) {
  let latest = 0;
  Object.values(session.agents || {}).forEach(bucket => {
    (bucket.messages || []).forEach(msg => {
      latest = Math.max(latest, Number(msg.time) || 0);
    });
  });
  return latest;
}

const api = {
  createEmptySession,
  deriveSessionTitle,
  ensureSessionAgent,
  getLatestSessionTimestamp,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.SessionModel = api;
```

- [ ] **Step 4: Load the helper in the browser and add a test script**

```html
<script src="js/storage.js"></script>
<script src="js/session-model.js"></script>
<script src="js/tools.js"></script>
```

```json
{
  "scripts": {
    "start": "electron .",
    "test": "node --test tests/session-model.test.js",
    "build": "electron-builder --win --x64"
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
npm test
```

Expected: PASS with `4 tests` completed

- [ ] **Step 6: Commit**

```bash
git add package.json renderer/matrix-upload.html renderer/js/session-model.js tests/session-model.test.js
git commit -m "test: add session model helpers"
```

### Task 2: Add Save/Restore And Legacy Compatibility Rules

**Files:**
- Modify: `e:\programs\matrix\renderer\js\session-model.js`
- Modify: `e:\programs\matrix\tests\session-model.test.js`

- [ ] **Step 1: Write failing tests for auto-save and legacy conversion**

```js
const {
  createEmptySession,
  ensureSessionAgent,
  shouldAutoSaveSession,
  normalizeSavedSession,
  migrateLegacyRuntimeChats,
} = require('../renderer/js/session-model.js');

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test
```

Expected: FAIL with `shouldAutoSaveSession is not a function` or equivalent export errors

- [ ] **Step 3: Implement normalization and migration helpers**

```js
function isSessionEmpty(session) {
  return getLatestSessionTimestamp(session) === 0;
}

function shouldAutoSaveSession(session) {
  return Boolean(session && session.dirty && !isSessionEmpty(session));
}

function normalizeSavedSession(record) {
  if (record && record.agents) {
    return {
      ...record,
      dirty: Boolean(record.dirty),
      lastActiveAgentId: record.lastActiveAgentId || null,
    };
  }
  const session = createEmptySession({
    id: record.id,
    currentAgentId: record.agentId || null,
    now: record.savedAt || Date.now(),
  });
  session.title = record.title || session.title;
  session.savedAt = record.savedAt || 0;
  if (record.agentId) {
    session.agents[record.agentId] = {
      agentId: record.agentId,
      agentName: record.agentName || record.agentId.toUpperCase(),
      messages: Array.isArray(record.messages) ? [...record.messages] : [],
    };
  }
  return session;
}

function migrateLegacyRuntimeChats(chatMap, agents, currentAgentId) {
  const session = createEmptySession({
    id: 'sess_' + Date.now(),
    currentAgentId,
    now: Date.now(),
  });
  agents.forEach(agent => {
    const messages = Array.isArray(chatMap[agent.id]) ? chatMap[agent.id] : [];
    if (messages.length > 0) {
      session.agents[agent.id] = {
        agentId: agent.id,
        agentName: agent.name,
        messages: [...messages],
      };
    }
  });
  session.savedAt = getLatestSessionTimestamp(session);
  session.dirty = session.savedAt > 0;
  return session;
}

const api = {
  createEmptySession,
  deriveSessionTitle,
  ensureSessionAgent,
  getLatestSessionTimestamp,
  isSessionEmpty,
  shouldAutoSaveSession,
  normalizeSavedSession,
  migrateLegacyRuntimeChats,
};
```

- [ ] **Step 4: Re-run the tests**

Run:

```bash
npm test
```

Expected: PASS with both the original and new session-model tests

- [ ] **Step 5: Commit**

```bash
git add renderer/js/session-model.js tests/session-model.test.js
git commit -m "test: cover session migration and restore rules"
```

### Task 3: Replace Per-Agent Runtime Storage With Current Session Storage

**Files:**
- Modify: `e:\programs\matrix\renderer\js\storage.js`
- Modify: `e:\programs\matrix\renderer\js\app.js`

- [ ] **Step 1: Reproduce the current failure manually**

```text
1. Run the app with npm start
2. Send one message to ARCHITECT
3. Mention another agent so it also replies
4. Click SAVE
5. Load the saved item and switch agents
Expected current behavior: only one agent history is effectively saved/restored
```

- [ ] **Step 2: Introduce current-session persistence helpers in storage.js**

```js
const CURRENT_SESSION_KEY = 'matrix_current_session_v1';
const SAVED_SESSIONS_KEY = 'matrix_sessions_v3';

let currentSession = null;

async function persistCurrentSession() {
  if (!currentSession) return false;
  localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify(currentSession));
  const ea = getEA();
  if (ea && ea.store && ea.store.set) {
    await ea.store.set('current_session', currentSession);
  }
  return true;
}

async function loadCurrentSessionFromStore() {
  const raw = localStorage.getItem(CURRENT_SESSION_KEY);
  if (raw) return SessionModel.normalizeSavedSession(JSON.parse(raw));
  const ea = getEA();
  const disk = ea && ea.store && ea.store.get ? await ea.store.get('current_session') : null;
  return disk ? SessionModel.normalizeSavedSession(disk) : null;
}

async function initCurrentSession(agents, currentAgentId) {
  currentSession = await loadCurrentSessionFromStore();
  if (!currentSession) {
    const legacyChats = {};
    agents.forEach(agent => {
      const raw = localStorage.getItem('chat_' + agent.id);
      legacyChats[agent.id] = raw ? JSON.parse(raw) : [];
    });
    currentSession = SessionModel.migrateLegacyRuntimeChats(legacyChats, agents, currentAgentId);
    await persistCurrentSession();
  }
  return currentSession;
}
```

- [ ] **Step 3: Add session-backed compatibility wrappers for existing chat callers**

```js
function getCurrentSession() {
  return currentSession;
}

function replaceCurrentSession(nextSession) {
  currentSession = SessionModel.normalizeSavedSession(nextSession);
  currentSession.dirty = false;
  return persistCurrentSession();
}

async function saveChat(agentId, messages) {
  if (!currentSession) return false;
  const agent = agents.find(a => a.id === agentId) || { id: agentId, name: agentId.toUpperCase() };
  const bucket = SessionModel.ensureSessionAgent(currentSession, agent);
  bucket.messages = messages.slice(-100);
  currentSession.lastActiveAgentId = currentAgentId || agentId;
  currentSession.savedAt = SessionModel.getLatestSessionTimestamp(currentSession);
  currentSession.dirty = true;
  return persistCurrentSession();
}

async function loadChat(agentId) {
  if (!currentSession) return [];
  const bucket = currentSession.agents[agentId];
  return bucket ? [...bucket.messages] : [];
}

function startFreshSession(activeAgentId) {
  currentSession = SessionModel.createEmptySession({
    id: 'sess_' + Date.now(),
    currentAgentId: activeAgentId,
    now: Date.now(),
  });
  persistCurrentSession();
}
```

- [ ] **Step 4: Initialize the current session before the app starts rendering chats**

```js
async function enterWhiteRoom() {
  document.getElementById('white-room').classList.add('active');
  initAgents();
  await initCurrentSession(agents, agents[0] && agents[0].id);
  hydrateAgentStatesFromCurrentSession();
  currentAgentId = getCurrentSession()?.lastActiveAgentId || agents[0]?.id || null;
  if (currentAgentId) selectAgent(currentAgentId);
  renderSessionsRight();
  startMatrixRain();
  setTimeout(() => { syncRuntimeToDisk(); startAutoSync(); }, 500);
}
```

- [ ] **Step 5: Verify the app now keeps one active session in storage**

Run:

```bash
npm start
```

Expected:

```text
- App boots without console errors
- localStorage contains matrix_current_session_v1
- Sending messages updates the current session instead of relying on chat_<agentId> as source of truth
```

- [ ] **Step 6: Commit**

```bash
git add renderer/js/storage.js renderer/js/app.js
git commit -m "feat: persist runtime chat as a single current session"
```

### Task 4: Rewire Chat Runtime And Agent Initialization To Session Accessors

**Files:**
- Modify: `e:\programs\matrix\renderer\js\chat.js`
- Modify: `e:\programs\matrix\renderer\js\agent.js`

- [ ] **Step 1: Add a failing regression test for active-agent restoration**

```js
const { normalizeSavedSession } = require('../renderer/js/session-model.js');

test('normalizeSavedSession backfills metadata on new-format sessions', () => {
  const session = normalizeSavedSession({
    id: 'sess_keep_active',
    title: 'X',
    savedAt: 20,
    agents: {
      debugger: { agentId: 'debugger', agentName: 'DEBUGGER', messages: [{ time: 20, text: 'ok' }] },
    },
  });
  assert.equal(session.lastActiveAgentId, null);
  assert.equal(session.dirty, false);
});
```

- [ ] **Step 2: Run the tests to verify the new expectation fails if normalization returns new-format records unchanged**

Run:

```bash
npm test
```

Expected: FAIL because `dirty` is `undefined` on the normalized session

- [ ] **Step 3: Hydrate agentStates from the current session and stop loading chats independently**

```js
function hydrateAgentStatesFromCurrentSession() {
  const session = getCurrentSession();
  agents.forEach(agent => {
    const st = ensureState(agent.id);
    const bucket = session && session.agents ? session.agents[agent.id] : null;
    st.messages = bucket ? [...bucket.messages] : [];
    st.isThinking = false;
    st.typing = null;
    st.status = '';
  });
}
```

```js
function initAgents() {
  let stored = JSON.parse(localStorage.getItem('matrix_agents_v2') || 'null');
  if (!stored) {
    const ea = window.electronAPI;
    if (ea && ea.storeCache && ea.storeCache.agents) stored = ea.storeCache.agents;
  }
  agents = stored || [...DEFAULT_AGENTS];
  renderAgents();
}
```

- [ ] **Step 4: Update runtime mutations to keep currentSession metadata in sync**

```js
function setAgentMessages(agentId, msgs) {
  const st = ensureState(agentId);
  st.messages = msgs;
  st.isThinking = false;
  if (st.typing) { clearTimeout(st.typing.timer); st.typing = null; }
  saveChat(agentId, msgs);
}

function selectAndRenderChat(agentId) {
  if (currentAgentId && agentStates[currentAgentId]) pauseTypewriter(currentAgentId);
  currentAgentId = agentId;
  const session = getCurrentSession();
  if (session) {
    session.lastActiveAgentId = agentId;
    persistCurrentSession();
  }
  renderAgentChat(agentId);
  resumeTypewriter(agentId);
}
```

- [ ] **Step 5: Verify multi-agent collaboration stays inside one runtime session**

Run:

```bash
npm start
```

Expected:

```text
- Messages from ARCHITECT and DEBUGGER both land in the same current session object
- Switching agents changes the visible chat only
- Refreshing the app restores the same current session and the same last active agent
```

- [ ] **Step 6: Commit**

```bash
git add renderer/js/chat.js renderer/js/agent.js renderer/js/session-model.js tests/session-model.test.js
git commit -m "feat: wire chat runtime to session-backed agent views"
```

### Task 5: Replace The Saved Sessions Panel, Restore Flow, And Import/Export

**Files:**
- Modify: `e:\programs\matrix\renderer\js\session.js`
- Modify: `e:\programs\matrix\renderer\js\storage.js`
- Modify: `e:\programs\matrix\renderer\js\agent.js`

- [ ] **Step 1: Reproduce the current save/restore mismatch manually**

```text
1. Start a multi-agent conversation
2. Click SAVE
3. Open the saved item
4. Switch to another agent
Expected current behavior: the loaded item is effectively a single-agent snapshot, not a whole-task session
```

- [ ] **Step 2: Rewrite session.js to save and list whole-session snapshots**

```js
function getSavedSessions() {
  return JSON.parse(localStorage.getItem('matrix_sessions_v3') || '[]')
    .map(SessionModel.normalizeSavedSession);
}

function saveSession() {
  const session = getCurrentSession();
  if (!session || SessionModel.isSessionEmpty(session)) {
    showToast('NO MESSAGES TO SAVE');
    return;
  }
  const saved = getSavedSessions();
  const snapshot = structuredClone(session);
  snapshot.id = 'sess_' + Date.now();
  snapshot.savedAt = SessionModel.getLatestSessionTimestamp(snapshot);
  snapshot.lastActiveAgentId = currentAgentId;
  snapshot.dirty = false;
  saved.unshift(snapshot);
  localStorage.setItem('matrix_sessions_v3', JSON.stringify(saved.slice(0, 30)));
  session.savedAt = snapshot.savedAt;
  session.dirty = false;
  persistCurrentSession();
  renderSessionsRight();
  showToast('SESSION SAVED');
}
```

```js
function renderSessionsRight() {
  const list = document.getElementById('session-list');
  const allSess = getSavedSessions();
  function formatSessionMinute(ts) {
    const d = new Date(ts || Date.now());
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  let html = '<div class="new-chat-btn" onclick="startNewChat()">NEW CHAT</div>';
  html += allSess.length === 0
    ? '<div class="sessions-empty">// NO SAVED SESSIONS //</div>'
    : allSess.map(session => `
        <div class="session-item" onclick="loadSavedSession('${session.id}')">
          <div class="session-title">${escapeHtml(session.title)}</div>
          <div class="session-date">${formatSessionMinute(session.savedAt)}</div>
        </div>
      `).join('');
  list.innerHTML = html;
}
```

- [ ] **Step 3: Implement guarded restore and whole-session new chat behavior**

```js
async function maybeAutoSaveCurrentSession() {
  const current = getCurrentSession();
  if (!SessionModel.shouldAutoSaveSession(current)) return;
  const snapshot = structuredClone(current);
  snapshot.id = 'sess_' + Date.now();
  snapshot.savedAt = SessionModel.getLatestSessionTimestamp(snapshot);
  snapshot.dirty = false;
  const saved = getSavedSessions();
  saved.unshift(snapshot);
  localStorage.setItem('matrix_sessions_v3', JSON.stringify(saved.slice(0, 30)));
}

async function loadSavedSession(id) {
  const target = getSavedSessions().find(session => session.id === id);
  if (!target) return;
  await maybeAutoSaveCurrentSession();
  replaceCurrentSession(structuredClone(target));
  hydrateAgentStatesFromCurrentSession();
  const nextAgentId = target.lastActiveAgentId && agents.some(a => a.id === target.lastActiveAgentId)
    ? target.lastActiveAgentId
    : (currentAgentId || agents[0]?.id);
  selectAgent(nextAgentId);
  renderSessionsRight();
  showToast('SESSION LOADED: ' + target.title);
}

function startNewChat() {
  maybeAutoSaveCurrentSession().then(() => {
    startFreshSession(currentAgentId || agents[0]?.id);
    hydrateAgentStatesFromCurrentSession();
    renderAgentChat(currentAgentId || agents[0]?.id);
    renderSessionsRight();
    showToast('// NEW CHAT INITIALIZED //');
  });
}
```

- [ ] **Step 4: Update import/export to include current session and new saved-session format**

```js
function exportData() {
  const data = {
    agents: JSON.parse(localStorage.getItem('matrix_agents_v2') || '[]'),
    currentSession: JSON.parse(localStorage.getItem('matrix_current_session_v1') || 'null'),
    sessions: JSON.parse(localStorage.getItem('matrix_sessions_v3') || '[]'),
    config: JSON.parse(localStorage.getItem('matrix_api_config') || '{}'),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'matrix_data_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('// DATA EXPORTED //');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const data = JSON.parse(e.target.result);
    if (data.agents) localStorage.setItem('matrix_agents_v2', JSON.stringify(data.agents));
    if (data.currentSession) {
      localStorage.setItem('matrix_current_session_v1', JSON.stringify(data.currentSession));
      replaceCurrentSession(SessionModel.normalizeSavedSession(data.currentSession));
    }
    if (data.sessions) localStorage.setItem('matrix_sessions_v3', JSON.stringify(data.sessions));
    if (data.config) localStorage.setItem('matrix_api_config', JSON.stringify(data.config));
    initAgents();
    hydrateAgentStatesFromCurrentSession();
    currentAgentId = getCurrentSession()?.lastActiveAgentId || agents[0]?.id || null;
    if (currentAgentId) selectAgent(currentAgentId);
    renderSessionsRight();
    showToast('// DATA IMPORTED //');
  };
  reader.readAsText(file);
  event.target.value = '';
}
```

- [ ] **Step 5: Keep deleted-agent behavior compatible with saved sessions**

```js
const session = getCurrentSession();
if (session && session.agents && session.agents[editId]) {
  delete session.agents[editId];
  session.dirty = true;
  persistCurrentSession();
}
hydrateAgentStatesFromCurrentSession();
```

- [ ] **Step 6: Verify the end-to-end save/restore flow**

Run:

```bash
npm start
```

Expected:

```text
- SAVE creates one record for the whole task
- Clicking the record restores all agent conversations in that task
- Switching agents shows each agent's own messages from the same saved session
- Loading another session auto-saves the current dirty non-empty session first
- Opening the same session repeatedly without changes does not create duplicates
- Import/export preserves currentSession and saved session snapshots
```

- [ ] **Step 7: Commit**

```bash
git add renderer/js/session.js renderer/js/storage.js renderer/js/agent.js
git commit -m "feat: save and restore full multi-agent sessions"
```

### Task 6: Final Regression Pass And Cleanup

**Files:**
- Modify: `e:\programs\matrix\renderer\js\storage.js`
- Modify: `e:\programs\matrix\renderer\js\session.js`
- Modify: `e:\programs\matrix\renderer\js\chat.js`

- [ ] **Step 1: Remove or demote leftover per-agent-only persistence paths**

```js
// Keep compatibility helpers, but stop using these as primary sources of truth:
// - chat_<agentId>
// - IndexedDB per-agent chat store
// - chat_history/{agentId}/ latest-file loading

// Acceptable cleanup shape:
async function migrateLocalStorageToIndexedDB() {
  return 0;
}

async function recoverChatsFromIndexedDB() {
  return 0;
}
```

- [ ] **Step 2: Run the automated tests**

Run:

```bash
npm test
```

Expected: PASS

- [ ] **Step 3: Run the app and perform the manual regression checklist**

Run:

```bash
npm start
```

Expected checklist:

```text
- App boot restores one active session
- First user message becomes the session title
- SAVE time matches the last message time to minute precision
- NEW CHAT creates a brand-new empty session
- Old single-agent saved records still open through normalizeSavedSession
```

- [ ] **Step 4: Check diagnostics**

Run:

```text
Use IDE diagnostics on:
- renderer/js/storage.js
- renderer/js/chat.js
- renderer/js/agent.js
- renderer/js/session.js
- renderer/js/session-model.js
```

Expected: no new errors introduced

- [ ] **Step 5: Commit**

```bash
git add renderer/js/storage.js renderer/js/chat.js renderer/js/agent.js renderer/js/session.js renderer/js/session-model.js tests/session-model.test.js
git commit -m "chore: finalize session-centric chat persistence"
```
