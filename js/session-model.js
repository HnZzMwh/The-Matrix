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

function normalizeSavedSession(record) {
  if (!record) return null;
  if (record.agents) {
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

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.SessionModel = api;
