// ============================================================
// SESSIONS — Save, Load, Export/Import
// ============================================================

function getSavedSessions() {
  const key = (typeof SAVED_SESSIONS_KEY !== 'undefined') ? SAVED_SESSIONS_KEY : 'matrix_sessions_v3';
  const legacyKey = 'matrix_sessions_v2';
  let raw = localStorage.getItem(key);
  if (!raw) raw = localStorage.getItem(legacyKey);
  return JSON.parse(raw || '[]').map(s => SessionModel.normalizeSavedSession(s));
}

function deleteSession(id) {
  if (!id) return;
  const key = (typeof SAVED_SESSIONS_KEY !== 'undefined') ? SAVED_SESSIONS_KEY : 'matrix_sessions_v3';
  const saved = getSavedSessions().filter(s => s.id !== id);
  localStorage.setItem(key, JSON.stringify(saved));

  // Also clear the current session if it matches the deleted one
  const currentSess = (typeof getCurrentSession === 'function') ? getCurrentSession() : null;
  if (currentSess && currentSess.id === id) {
    Object.keys(agentStates).forEach(aid => {
      const st = agentStates[aid];
      if (st) {
        st.messages = [];
        st.isThinking = false;
        if (st.typing) { clearTimeout(st.typing.timer); st.typing = null; }
      }
    });
    const area = document.getElementById('messages-area');
    if (area) area.innerHTML = '';
    if (typeof renderedCount !== 'undefined') {
      Object.keys(renderedCount).forEach(k => { renderedCount[k] = 0; });
    }
    if (typeof currentDisplayedAgent !== 'undefined') currentDisplayedAgent = null;
    updateEmptyChat();
    if (typeof startFreshSession === 'function') {
      startFreshSession(currentAgentId || (agents[0] && agents[0].id), null);
    }
  }

  renderSessionsRight();
  showToast('// SESSION DELETED //');
}

// ─── Collapsible session groups ─────────────────────────────
const collapsedGroups = {};

function toggleSessionGroup(idx) {
  const key = window._sg_keys[idx];
  if (key !== undefined) {
    collapsedGroups[key] = !collapsedGroups[key];
  }
  renderSessionsRight();
}

// ─── Determine which group a session belongs to ──────────────
function hasUserMessages(session) {
  if (!session || !session.agents) return false;
  return Object.values(session.agents).some(bucket =>
    (bucket.messages || []).some(m => m.role === 'user')
  );
}

function getGroupKey(session) {
  const current = (typeof getCurrentSession === 'function') ? getCurrentSession() : null;
  const isCurrent = session && session.id === current?.id;
  const isCode = session.mode === 'code';
  const hasMsgs = hasUserMessages(session);

  if (isCode) {
    // CODE sessions group by folder path
    return session.folderPath || '__code_conv__';
  }
  if (!isCurrent && hasMsgs) {
    // Finished CHAT sessions → CHAT HISTORY
    return '__chat_history__';
  }
  // All sessions go to CHAT HISTORY (no separate CONVERSATIONS group)
  return '__chat_history__';
}

// ─── Create a new CODE session from an existing workspace ────
async function createCodeSessionFromWorkspace(folderPath) {
  if (!folderPath) return;
  if (typeof maybeAutoSaveCurrentSession === 'function') {
    await maybeAutoSaveCurrentSession();
  }
  const agentId = currentAgentId || (agents[0] && agents[0].id);
  if (!agentId) { showToast('// NO AGENT AVAILABLE //'); return; }

  const newSession = SessionModel.createEmptySession({
    id: 'sess_' + Date.now(),
    currentAgentId: agentId,
  });
  newSession.mode = 'code';
  newSession.folderPath = folderPath;
  currentSession = newSession;

  if (typeof persistCurrentSession === 'function') persistCurrentSession();

  // Hydrate agent states
  if (typeof hydrateAgentStatesFromCurrentSession === 'function') hydrateAgentStatesFromCurrentSession();
  if (typeof selectAgent === 'function') selectAgent(agentId);

  // Auto-switch to CODE mode
  if (typeof setSessionMode === 'function') setSessionMode('code');

  saveCurrentToSessionList();
  renderSessionsRight();

  // Update panel title and mode toggle button
  var modeBtn = document.getElementById('mode-toggle-btn');
  var panelTitle = document.getElementById('sessions-panel-title');
  if (panelTitle) panelTitle.textContent = 'SESSIONS';
  if (modeBtn && typeof getCurrentMode === 'function') {
    modeBtn.textContent = '[ CODE ]';
  }

  showToast('// NEW CODE SESSION //');
}

// ─── Create a plain CHAT session (NEW SESSION button) ───────
function createChatSession() {
  if (typeof maybeAutoSaveCurrentSession === 'function') {
    maybeAutoSaveCurrentSession();
  }
  const agentId = currentAgentId || (agents[0] && agents[0].id);
  if (!agentId) { showToast('// NO AGENT AVAILABLE //'); return; }

  if (typeof startFreshSession === 'function') {
    startFreshSession(agentId, null);  // null = no workspace
  }
  if (typeof hydrateAgentStatesFromCurrentSession === 'function') {
    hydrateAgentStatesFromCurrentSession();
  }
  if (typeof selectAgent === 'function') selectAgent(agentId);
  if (typeof setSessionMode === 'function') setSessionMode('chat');

  saveCurrentToSessionList();
  renderSessionsRight();

  // Update panel title and mode toggle button
  var modeBtn = document.getElementById('mode-toggle-btn');
  var panelTitle = document.getElementById('sessions-panel-title');
  if (panelTitle) panelTitle.textContent = 'CHAT HISTORY';
  if (modeBtn && typeof getCurrentMode === 'function') {
    modeBtn.textContent = '[ CHAT ]';
  }

  showToast('// NEW CHAT SESSION //');
}

function renderSessionsRight() {
  const list = document.getElementById('session-list');
  if (!list) return;
  const allSess = getSavedSessions();
  const mode = (typeof getCurrentMode === 'function') ? getCurrentMode() : 'chat';
  const isChat = mode === 'chat';

  function formatSessionMinute(ts) {
    const d = new Date(ts || Date.now());
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // Update panel title based on mode
  const panelTitle = document.getElementById('sessions-panel-title');
  if (panelTitle) {
    panelTitle.textContent = isChat ? 'CHAT HISTORY' : 'SESSIONS';
  }

  // Build button text based on mode
  const btnLabel = isChat ? 'NEW CHAT' : 'NEW SESSION';
  const btnAction = isChat ? 'createChatSession()' : 'startNewSession()';

  let html = `<div class="new-session-btn" onclick="${btnAction}">+ ${btnLabel}</div>`;

  if (allSess.length === 0) {
    html += `<div class="sessions-empty">// NO SAVED SESSIONS //</div>`;
    list.innerHTML = html;
    return;
  }

  // Group sessions based on mode
  const groups = {};
  allSess.forEach(s => {
    const key = getGroupKey(s);
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  });

  // Sort groups
  const groupKeys = Object.keys(groups);
  let sortedKeys;

  if (isChat) {
    // CHAT mode: all sessions in CHAT HISTORY
    sortedKeys = [
      ...(groupKeys.includes('__chat_history__') ? ['__chat_history__'] : []),
    ];
  } else {
    // CODE mode: group by folder workspace path, sorted alphabetically
    sortedKeys = groupKeys.filter(k => k !== '__conv__' && k !== '__chat_history__').sort();
  }

  // Store key map globally for index-based toggle
  window._sg_keys = sortedKeys;

  sortedKeys.forEach((key, idx) => {
    const sessions = groups[key];
    const isCollapsed = collapsedGroups[key];
    const isChatHistory = key === '__chat_history__';

    if (isChatHistory) {
      html += `<div class="session-group">
        <div class="session-group-body">`;
      sessions.forEach(s => {
        html += renderSessionItem(s, formatSessionMinute);
      });
      html += `</div></div>`;
    } else {
      const cleanPath = key.replace(/[\\/]+$/, '');
      const folderName = cleanPath.split(/[\\/]/).pop() || key;
      html += `<div class="session-group">
        <div class="session-group-hdr" onclick="toggleSessionGroup(${idx})">
          <span class="sg-arrow ${isCollapsed ? '' : 'open'}">▸</span>
          <span class="sg-name">${escapeHtml(folderName)}</span>
          <button class="session-add-btn" data-add-id="${key}" title="New session in this workspace">+</button>
        </div>
        <div class="session-group-body" style="${isCollapsed ? 'display:none' : ''}">`;
      sessions.forEach(s => {
        html += renderSessionItem(s, formatSessionMinute);
      });
      html += `</div></div>`;
    }
  });

  list.innerHTML = html;
}

function renderSessionItem(s, formatFn) {
  return `<div class="session-item" data-session-id="${s.id}" title="${escapeHtml(s.title)}">
    <div class="session-title">${escapeHtml(s.title)}</div>
    <button class="session-delete-btn" data-delete-id="${s.id}" title="Delete session">X</button>
  </div>`;
}

async function maybeAutoSaveCurrentSession() {
  const current = (typeof getCurrentSession === 'function') ? getCurrentSession() : null;
  if (!SessionModel.shouldAutoSaveSession(current)) return;

  const snapshot = JSON.parse(JSON.stringify(current));
  snapshot.id = 'sess_' + Date.now();
  snapshot.savedAt = SessionModel.getLatestSessionTimestamp(snapshot);
  snapshot.dirty = false;
  snapshot.folderPath = current.folderPath || null;

  if (snapshot.title.startsWith('SESSION_')) {
    let firstUserText = '';
    Object.values(snapshot.agents).some(bucket => {
      const first = bucket.messages.find(m => m.role === 'user');
      if (first) { firstUserText = first.text; return true; }
      return false;
    });
    if (firstUserText) snapshot.title = SessionModel.deriveSessionTitle(firstUserText);
  }

  const saved = getSavedSessions();
  saved.unshift(snapshot);
  const key = (typeof SAVED_SESSIONS_KEY !== 'undefined') ? SAVED_SESSIONS_KEY : 'matrix_sessions_v3';
  localStorage.setItem(key, JSON.stringify(saved.slice(0, 30)));
}

async function loadSavedSession(id) {
  const target = getSavedSessions().find(s => s.id === id);
  if (!target) return;

  await maybeAutoSaveCurrentSession();

  if (typeof replaceCurrentSession === 'function') {
    await replaceCurrentSession(JSON.parse(JSON.stringify(target)));
  }

  if (typeof hydrateAgentStatesFromCurrentSession === 'function') {
    hydrateAgentStatesFromCurrentSession();
  }

  const nextAgentId = target.lastActiveAgentId && agents.some(a => a.id === target.lastActiveAgentId)
    ? target.lastActiveAgentId
    : (currentAgentId || (agents[0] && agents[0].id));

  if (nextAgentId) selectAgent(nextAgentId);
  renderSessionsRight();
  showToast('SESSION LOADED: ' + target.title);
}

// ─── Start new session — opens wizard ──────────────────────
function startNewSession() {
  openSessionWizard();
}

function loadSessions() { renderSessionsRight(); }

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('load-btn').addEventListener('click', loadSessions);
  document.getElementById('modal-close-btn').addEventListener('click', () => {
    document.getElementById('saved-panel').classList.remove('active');
  });

  // Event delegation for session items (data-driven, prevents XSS from quote injection)
  const list = document.getElementById('session-list');
  if (list) {
    list.addEventListener('click', (e) => {
      // Handle add (+) button — creates new session in same workspace
      const addBtn = e.target.closest('.session-add-btn');
      if (addBtn) {
        e.stopPropagation();
        const key = addBtn.getAttribute('data-add-id');
        // Group keys are folder paths for CODE sessions
        if (key && key.startsWith('__')) {
          createChatSession();
        } else {
          createCodeSessionFromWorkspace(key);
        }
        return;
      }
      // Handle delete button
      const deleteBtn = e.target.closest('.session-delete-btn');
      if (deleteBtn) {
        e.stopPropagation();
        const id = deleteBtn.getAttribute('data-delete-id');
        if (id) deleteSession(id);
        return;
      }
      // Handle session item click (load session)
      const item = e.target.closest('.session-item');
      if (item) {
        const id = item.getAttribute('data-session-id');
        if (id) loadSavedSession(id);
      }
    });
  }
});
