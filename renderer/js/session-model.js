function createEmptySession({ id, currentAgentId, now = Date.now() }) {
  return {
    id,
    title: 'SESSION_' + now,
    createdAt: now,
    savedAt: 0,
    lastActiveAgentId: currentAgentId || null,
    dirty: false,
    mode: 'chat',
    agents: {},
  };
}

function deriveSessionTitle(text) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ').toUpperCase();
  if (!clean) return 'SESSION_' + Date.now();
  return clean.length > 27 ? clean.slice(0, 27) + '...' : clean;
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

function isSessionEmpty(session) {
  return getLatestSessionTimestamp(session) === 0;
}

function shouldAutoSaveSession(session) {
  return Boolean(session && session.dirty && !isSessionEmpty(session));
}

/**
 * Fire-and-forget: ask LLM to generate a concise session title.
 * Updates currentSession.title and persists to disk if successful.
 */
// Throttle to prevent duplicate concurrent title generation calls
let _titleGenPending = false;

function generateSessionTitle(userMessage, agentId) {
  if (!userMessage) return null;
  if (_titleGenPending) return _titleGenPending; // skip if already pending

  // Fallback: derive title from message text without LLM
  const fallbackTitle = deriveSessionTitle(userMessage);

  if (typeof callLLM !== 'function') {
    applyTitle(fallbackTitle);
    return fallbackTitle;
  }

  const titlePrompt = 'You are a title generator. Based on the user\'s first message below, generate a CONCISE session title (maximum 5 words, English only). Output ONLY the title, no quotes, no punctuation, no explanation.\n\nUser message:';
  const messages = [{ role: 'user', content: titlePrompt + ' "' + String(userMessage).slice(0, 300) + '"' }];

  _titleGenPending = (async () => {
    try {
      const title = await callLLM(messages, 'Generate a concise session title (5 words max).', agentId);
      if (!title) { applyTitle(fallbackTitle); return fallbackTitle; }
      // Clean up: remove quotes, newlines, extra spaces
      let clean = String(title).replace(/["'\n\r]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
      if (clean.length > 35) clean = clean.slice(0, 35);
      if (!clean || clean.length < 2) { applyTitle(fallbackTitle); return fallbackTitle; }

      applyTitle(clean);
      console.log('[Session] Title generated:', clean);
      return clean;
    } catch (e) {
      console.warn('[Session] Title generation failed:', e.message);
      applyTitle(fallbackTitle);
      return fallbackTitle;
    } finally {
      _titleGenPending = false;
    }
  })();

  return _titleGenPending;
}

async function applyTitle(clean) {
  const session = (typeof getCurrentSession === 'function') ? getCurrentSession() : null;
  if (session) {
    session.title = clean;
    session.dirty = true;
  }

  // Persist to saved sessions list
  if (typeof maybeAutoSaveCurrentSession === 'function') {
    try { await maybeAutoSaveCurrentSession(); } catch {}
  }

  // Update UI
  if (typeof renderSessionsRight === 'function') {
    try { renderSessionsRight(); } catch {}
  }
}

function normalizeSavedSession(record) {
  if (!record) return null;
  if (record.agents) {
    return {
      ...record,
      dirty: Boolean(record.dirty),
      lastActiveAgentId: record.lastActiveAgentId || null,
      mode: record.mode || 'chat',
    };
  }

  const session = createEmptySession({
    id: record.id,
    currentAgentId: record.agentId || null,
    now: record.savedAt || Date.now(),
  });
  session.mode = 'chat';
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
  generateSessionTitle,
  normalizeSavedSession,
  migrateLegacyRuntimeChats,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') {
  // Guard against re-assignment if script is loaded multiple times
  if (!window.SessionModel) window.SessionModel = api;
}
