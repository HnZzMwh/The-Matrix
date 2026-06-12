// ============================================================
// AGENT MEMORY — Per-agent persistent memory system with three tiers:
// 1. Capabilities Layer (能力层) — role, skills, tools, expertise
// 2. Self-Critique Memory (自我批判) — code reviews, lessons, iterations
// 3. Conversation Memory (对话记忆) — summaries, user preferences, key decisions
// ============================================================

const MEM_DB_NAME = 'matrix_agent_memory_db';
const MEM_DB_VER = 1;
let memDB = null;

function openMemDB() {
  if (memDB) return Promise.resolve(memDB);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MEM_DB_NAME, MEM_DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('agent_memory')) {
        const store = db.createObjectStore('agent_memory', { keyPath: 'agentId' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    req.onsuccess = (e) => { memDB = e.target.result; resolve(memDB); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function memTx(mode) {
  return openMemDB().then(db => db.transaction('agent_memory', mode).objectStore('agent_memory'));
}

// ─── Default memory template for a new agent ────────────────
function defaultAgentMemory(agentId) {
  const ag = (typeof agents !== 'undefined') ? agents.find(a => a.id === agentId) : null;
  return {
    agentId,
    agentName: ag?.name || agentId.toUpperCase(),
    agentRole: ag?.role || '// AGENT //',
    updatedAt: Date.now(),
    createdAt: Date.now(),

    // ── Tier 1: Capabilities Layer ──
    capabilities: {
      role: ag?.role || '',
      skills: [],
      tools: [],
      strengths: [],
      weaknesses: [],
      codingPreferences: {},
      technicalExpertise: [],
      toolsExpertise: {},     // toolName -> { usageCount, lastUsed, notes }
    },

    // ── Tier 2: Self-Critique Memory ──
    critiques: [],

    // ── Tier 3: Conversation Memory ──
    conversationMemories: [],

    // ── Personal Iteration Log ──
    iterations: [],
  };
}

// ─── Load memory for an agent ───────────────────────────────
async function loadAgentMemory(agentId) {
  if (!agentId) return defaultAgentMemory('unknown');
  try {
    const st = await memTx('readonly');
    const data = await new Promise((resolve, reject) => {
      const req = st.get(agentId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = reject;
    });
    if (data) return data;
  } catch (e) {}
  // Fallback: try localStorage
  try {
    const raw = localStorage.getItem('matrix_agent_mem_' + agentId);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate to IndexedDB
      saveAgentMemory(parsed);
      return parsed;
    }
  } catch (e) {}
  return defaultAgentMemory(agentId);
}

// ─── Save memory for an agent ───────────────────────────────
async function saveAgentMemory(data) {
  data.updatedAt = Date.now();
  try {
    const st = await memTx('readwrite');
    await new Promise((resolve, reject) => {
      const req = st.put(data);
      req.onsuccess = resolve;
      req.onerror = reject;
    });
  } catch (e) {
    // Fallback to localStorage
    try {
      localStorage.setItem('matrix_agent_mem_' + data.agentId, JSON.stringify(data));
    } catch (e2) {}
  }
  return data;
}

// ═══════════════════════════════════════════════════════════
// TIER 1: CAPABILITIES LAYER
// ═══════════════════════════════════════════════════════════

// Save a capability about this agent
async function saveCapability(agentId, category, key, value) {
  const mem = await loadAgentMemory(agentId);
  if (!mem.capabilities[category]) mem.capabilities[category] = {};
  if (typeof value === 'object' && Array.isArray(mem.capabilities[category])) {
    // Array category
    if (!mem.capabilities[category].find(v => typeof v === 'string' ? v === value : JSON.stringify(v) === JSON.stringify(value))) {
      mem.capabilities[category].push(value);
    }
  } else if (typeof value === 'object') {
    mem.capabilities[category][key] = value;
  } else if (key) {
    mem.capabilities[category][key] = value;
  }
  await saveAgentMemory(mem);
  return { ok: true, category, key, value };
}

// Record tool usage for expertise tracking
async function recordToolUsage(agentId, toolName, notes) {
  const mem = await loadAgentMemory(agentId);
  if (!mem.capabilities.toolsExpertise[toolName]) {
    mem.capabilities.toolsExpertise[toolName] = { usageCount: 0, lastUsed: null, notes: '' };
  }
  mem.capabilities.toolsExpertise[toolName].usageCount++;
  mem.capabilities.toolsExpertise[toolName].lastUsed = Date.now();
  if (notes) mem.capabilities.toolsExpertise[toolName].notes = notes;
  // Also ensure tool is in tools list
  if (!mem.capabilities.tools.includes(toolName)) {
    mem.capabilities.tools.push(toolName);
  }
  await saveAgentMemory(mem);
}

// Query agent capabilities
async function queryCapabilities(agentId, query) {
  const mem = await loadAgentMemory(agentId);
  const q = (query || '').toLowerCase();
  if (!q) {
    const cap = mem.capabilities;
    const lines = [`=== CAPABILITIES: ${mem.agentName} ===`];
    lines.push(`Role: ${cap.role}`);
    if (cap.skills.length > 0) lines.push(`Skills: ${cap.skills.join(', ')}`);
    if (cap.tools.length > 0) lines.push(`Tools: ${cap.tools.join(', ')}`);
    if (cap.strengths.length > 0) lines.push(`Strengths: ${cap.strengths.join(', ')}`);
    if (cap.weaknesses.length > 0) lines.push(`Weaknesses to improve: ${cap.weaknesses.join(', ')}`);
    if (cap.technicalExpertise.length > 0) lines.push(`Expertise: ${cap.technicalExpertise.join(', ')}`);
    if (Object.keys(cap.codingPreferences).length > 0) {
      lines.push('Coding Preferences:');
      for (const [k, v] of Object.entries(cap.codingPreferences)) lines.push(`  ${k}: ${v}`);
    }
    if (Object.keys(cap.toolsExpertise).length > 0) {
      const tools = Object.entries(cap.toolsExpertise)
        .sort((a, b) => b[1].usageCount - a[1].usageCount)
        .slice(0, 10);
      lines.push('Tool Expertise (top):');
      for (const [tool, info] of tools) {
        lines.push(`  ${tool}: used ${info.usageCount}x`);
      }
    }
    return lines.join('\n');
  }
  // Search capabilities
  const results = [];
  for (const [cat, val] of Object.entries(mem.capabilities)) {
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    if (str.toLowerCase().includes(q)) {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (String(item).toLowerCase().includes(q)) results.push(`[${cat}] ${item}`);
        }
      } else if (typeof val === 'object') {
        for (const [k, v] of Object.entries(val)) {
          if (k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)) {
            results.push(`[${cat}] ${k}: ${v}`);
          }
        }
      } else {
        results.push(`[${cat}] ${val}`);
      }
    }
  }
  return results.length > 0
    ? `🔍 Capabilities matching "${query}":\n${results.join('\n')}`
    : `// No capabilities found matching "${query}" for ${mem.agentName}`;
}

// ═══════════════════════════════════════════════════════════
// TIER 2: SELF-CRITIQUE MEMORY
// ═══════════════════════════════════════════════════════════

// Add a self-critique entry
async function addCritique(agentId, filePath, issue, lesson, improvement, severity) {
  const mem = await loadAgentMemory(agentId);
  const critique = {
    id: 'crit_' + Date.now().toString(36).toUpperCase(),
    timestamp: Date.now(),
    filePath: filePath || '',
    issue: issue || '',
    lesson: lesson || '',
    improvement: improvement || '',
    severity: severity || 'medium',
    resolved: false,
  };
  mem.critiques.push(critique);
  await saveAgentMemory(mem);
  return critique;
}

// Review past critiques — returns relevant lessons based on context
async function reviewCritiques(agentId, context) {
  const mem = await loadAgentMemory(agentId);
  if (mem.critiques.length === 0) {
    return `// ${mem.agentName} has no self-critique records yet.`;
  }
  const q = (context || '').toLowerCase();
  let relevant = mem.critiques;
  if (q) {
    relevant = mem.critiques.filter(c =>
      c.filePath?.toLowerCase().includes(q) ||
      c.issue?.toLowerCase().includes(q) ||
      c.lesson?.toLowerCase().includes(q)
    );
  }
  // Sort by recency
  relevant = relevant.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
  const lines = [`=== SELF-CRITIQUE LOG: ${mem.agentName} ===`];
  if (q) lines.push(`(filtered by: "${context}")`);
  lines.push(`Total critiques: ${mem.critiques.length}, showing: ${relevant.length}`);
  lines.push('');
  for (const c of relevant) {
    const date = new Date(c.timestamp).toLocaleDateString();
    const icon = c.severity === 'high' ? '🔴' : c.severity === 'low' ? '🟢' : '🟡';
    lines.push(`${icon} [${c.severity}] ${c.id} (${date})`);
    if (c.filePath) lines.push(`   File: ${c.filePath}`);
    lines.push(`   Issue: ${c.issue}`);
    lines.push(`   Lesson: ${c.lesson}`);
    if (c.improvement) lines.push(`   Fix: ${c.improvement}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════
// TIER 3: CONVERSATION MEMORY
// ═══════════════════════════════════════════════════════════

// Save a conversation memory
async function saveConversationMemory(agentId, summary, keyPoints, userPreferences) {
  const mem = await loadAgentMemory(agentId);
  mem.conversationMemories.push({
    timestamp: Date.now(),
    summary: summary || '',
    keyPoints: keyPoints || [],
    userPreferences: userPreferences || {},
  });
  // Keep last 100 conversation memories
  if (mem.conversationMemories.length > 100) {
    mem.conversationMemories = mem.conversationMemories.slice(-100);
  }
  await saveAgentMemory(mem);
}

// Recall conversation memories
async function recallMemories(agentId, query) {
  const mem = await loadAgentMemory(agentId);
  if (mem.conversationMemories.length === 0) {
    return `// ${mem.agentName} has no conversation memories yet.`;
  }
  const q = (query || '').toLowerCase();
  let relevant = mem.conversationMemories;
  if (q) {
    relevant = mem.conversationMemories.filter(m =>
      m.summary?.toLowerCase().includes(q) ||
      m.keyPoints?.some(k => k.toLowerCase().includes(q))
    );
  }
  relevant = relevant.sort((a, b) => b.timestamp - a.timestamp).slice(0, 15);
  const lines = [`=== CONVERSATION MEMORIES: ${mem.agentName} ===`];
  if (q) lines.push(`(searching: "${query}")`);
  lines.push(`Total memories: ${mem.conversationMemories.length}, showing: ${relevant.length}`);
  lines.push('');
  for (const m of relevant) {
    const date = new Date(m.timestamp).toLocaleDateString();
    lines.push(`📝 ${date}`);
    lines.push(`   ${m.summary}`);
    if (m.keyPoints.length > 0) {
      lines.push(`   Key points: ${m.keyPoints.join(', ')}`);
    }
    if (Object.keys(m.userPreferences).length > 0) {
      for (const [k, v] of Object.entries(m.userPreferences)) {
        lines.push(`   Preference: ${k} = ${v}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════
// PERSONAL ITERATION LOG
// ═══════════════════════════════════════════════════════════

// Log a personal iteration/improvement
async function addIteration(agentId, before, after, reflection, codeReference) {
  const mem = await loadAgentMemory(agentId);
  mem.iterations.push({
    timestamp: Date.now(),
    before: before || '',
    after: after || '',
    reflection: reflection || '',
    codeReference: codeReference || '',
  });
  await saveAgentMemory(mem);
}

// ═══════════════════════════════════════════════════════════
// MEMORY SUMMARY (for agent prompt injection)
// ═══════════════════════════════════════════════════════════

// Build a condensed memory summary for injecting into agent prompts
async function buildMemorySummary(agentId) {
  const mem = await loadAgentMemory(agentId);
  const parts = [];

  // Capabilities summary
  const cap = mem.capabilities;
  if (cap.skills.length > 0) parts.push(`Skills: ${cap.skills.join(', ')}`);
  if (cap.strengths.length > 0) parts.push(`Strengths: ${cap.strengths.join(', ')}`);
  if (cap.weaknesses.length > 0) parts.push(`Self-known areas to improve: ${cap.weaknesses.join(', ')}`);
  if (Object.keys(cap.codingPreferences).length > 0) {
    const prefs = Object.entries(cap.codingPreferences).map(([k, v]) => `${k}=${v}`).join(', ');
    parts.push(`Coding preferences: ${prefs}`);
  }

  // Recent critiques (last 3)
  const recentCrits = mem.critiques.sort((a, b) => b.timestamp - a.timestamp).slice(0, 3);
  if (recentCrits.length > 0) {
    const critLines = recentCrits.map(c => `  - ${c.lesson}`);
    parts.push(`Recent lessons learned:\n${critLines.join('\n')}`);
  }

  // Recent conversation memories (last 3)
  const recentMems = mem.conversationMemories.sort((a, b) => b.timestamp - a.timestamp).slice(0, 3);
  if (recentMems.length > 0) {
    const memLines = recentMems.map(m => `  - ${m.summary}`);
    parts.push(`Recent context:\n${memLines.join('\n')}`);
  }

  if (parts.length === 0) return '';
  return `\n\n## Your Memory (persistent across sessions)\n${parts.join('\n')}`;
}

// ═══════════════════════════════════════════════════════════
// AUTO-SAVE: summarize current conversation into memory
// ═══════════════════════════════════════════════════════════

async function autoSaveConversationMemory(agentId) {
  const st = typeof agentStates !== 'undefined' ? agentStates[agentId] : null;
  if (!st || st.messages.length < 2) return;
  // Extract key info from the last few messages
  const recentMessages = st.messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-6);
  if (recentMessages.length < 2) return;
  // Build a summary from the conversation
  const userMessages = recentMessages.filter(m => m.role === 'user').map(m => m.text).join(' | ');
  const assistantMessages = recentMessages.filter(m => m.role === 'assistant').map(m => m.text);
  // Extract key points (first line of each assistant response, or any explicit decisions)
  const keyPoints = [];
  for (const msg of assistantMessages) {
    const firstLine = msg.split('\n')[0].slice(0, 120);
    if (firstLine && !firstLine.startsWith('[TOOL:')) keyPoints.push(firstLine);
    // Extract decisions
    const decisions = msg.match(/decision|chose|selected|use\s+\w+\s+over|prefer/i);
    if (decisions) {
      const lines = msg.split('\n').filter(l => /decision|chose|select|prefer|use\s+\w+\s+over/i.test(l));
      for (const l of lines.slice(0, 2)) keyPoints.push(l.slice(0, 100));
    }
  }
  const summary = userMessages.slice(0, 200);
  if (summary) {
    await saveConversationMemory(agentId, summary, keyPoints.slice(0, 5), {});
  }
}

// ═══════════════════════════════════════════════════════════
// SELF-REVIEW: agent reviews its own past code
// ═══════════════════════════════════════════════════════════

async function selfReview(agentId, filePath) {
  const mem = await loadAgentMemory(agentId);
  const ag = (typeof agents !== 'undefined') ? agents.find(a => a.id === agentId) : null;
  if (!ag) return `// Agent "${agentId}" not found`;

  // Check if there are existing critiques for this file
  const existingCritiques = mem.critiques.filter(c => c.filePath === filePath);
  const hasHistory = existingCritiques.length > 0;

  let review = `=== SELF-REVIEW by ${ag.name} ===\n`;
  review += `File: ${filePath}\n`;
  review += `Previous critiques for this file: ${existingCritiques.length}\n\n`;

  if (hasHistory) {
    review += `Lessons from past work on this file:\n`;
    for (const c of existingCritiques.slice(-5)) {
      review += `  • ${c.issue}\n`;
      review += `    → Lesson: ${c.lesson}\n`;
    }
    review += `\nRecommendation: Before editing, verify these past issues are not repeated.\n`;
  } else {
    review += `No prior self-critique records for this file.\n`;
    review += `Recommendation: After changes, use [TOOL: add_critique ...] to document lessons learned.\n`;
  }

  // Tool usage review
  const toolExpertise = mem.capabilities.toolsExpertise;
  const toolsUsed = Object.entries(toolExpertise)
    .filter(([_, info]) => info.usageCount > 0)
    .sort((a, b) => b[1].usageCount - a[1].usageCount);
  if (toolsUsed.length > 0) {
    review += `\nYour most熟练熟练 tools:\n`;
    for (const [tool, info] of toolsUsed.slice(0, 5)) {
      review += `  • ${tool} (used ${info.usageCount}x)\n`;
    }
  }

  return review;
}

// ═══════════════════════════════════════════════════════════
// EXPORT / DEBUG
// ═══════════════════════════════════════════════════════════

async function getAgentMemoryStats(agentId) {
  const mem = await loadAgentMemory(agentId);
  return {
    agentName: mem.agentName,
    skills: mem.capabilities.skills.length,
    tools: mem.capabilities.tools.length,
    critiques: mem.critiques.length,
    conversationMemories: mem.conversationMemories.length,
    iterations: mem.iterations.length,
    updatedAt: mem.updatedAt,
  };
}

// ─── Init memory DB on load ─────────────────────────────────
if (typeof window !== 'undefined') {
  openMemDB().catch(() => {});
}
