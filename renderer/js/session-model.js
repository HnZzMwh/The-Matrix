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

const api = {
  createEmptySession,
  deriveSessionTitle,
  ensureSessionAgent,
  getLatestSessionTimestamp,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.SessionModel = api;
