// ============================================================
// ARCHITECTURE MEMORY — Persistent tech stack, module boundaries,
// coding conventions, API style, and architecture decisions.
// ============================================================

const ARCH_DB_NAME = 'matrix_arch_db';
const ARCH_DB_VER = 1;
let archDB = null;

function openArchDB() {
  if (archDB) return Promise.resolve(archDB);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ARCH_DB_NAME, ARCH_DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('memory')) {
        const store = db.createObjectStore('memory', { keyPath: 'key' });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = (e) => { archDB = e.target.result; resolve(archDB); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function archTx(mode) {
  return openArchDB().then(db => db.transaction('memory', mode).objectStore('memory'));
}

// ─── Default architecture memory template ────────────────────
function defaultArchMemory() {
  return {
    key: 'arch_root',
    category: 'root',
    techStack: {},
    directoryStructure: [],
    moduleBoundaries: [],   // { module, allowedImports[], forbiddenImports[], description }
    codingConventions: [],  // { rule, scope, details }
    apiStyle: {},
    architectureDecisions: [], // { id, date, decision, reason, author }
    fileOwnership: [],      // { pattern, owner, description } — e.g. { pattern: "backend/*", owner: "anderson" }
    techDebt: [],           // { id, description, severity, location, created, status }
    schemaRegistry: [],     // { name, version, fields[], consumers[], description }
    timestamp: Date.now(),
  };
}

// ─── Initialize / load architecture memory ───────────────────
async function initArchMemory() {
  try {
    const st = await archTx('readonly');
    const data = await new Promise((resolve, reject) => {
      const req = st.get('arch_root');
      req.onsuccess = () => resolve(req.result);
      req.onerror = reject;
    });
    if (data) return data;
  } catch (e) {}
  // Fallback: try localStorage
  try {
    const raw = localStorage.getItem('matrix_arch_memory');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return defaultArchMemory();
}

// ─── Save architecture memory ────────────────────────────────
async function saveArchMemory(data) {
  data.timestamp = Date.now();
  try {
    const st = await archTx('readwrite');
    await new Promise((resolve, reject) => {
      const req = st.put(data);
      req.onsuccess = resolve;
      req.onerror = reject;
    });
  } catch (e) {
    // Fallback to localStorage
    try {
      localStorage.setItem('matrix_arch_memory', JSON.stringify(data));
    } catch (e2) {}
  }
  return data;
}

// ─── Add an architecture decision (ADR) ──────────────────────
async function saveArchDecision(decision, reason, author) {
  const mem = await initArchMemory();
  const adr = {
    id: 'ADR-' + Date.now().toString(36).toUpperCase(),
    date: new Date().toISOString(),
    decision,
    reason: reason || '',
    author: author || 'ARCHITECT',
  };
  mem.architectureDecisions.push(adr);
  await saveArchMemory(mem);
  return adr;
}

// ─── Add a module boundary rule ──────────────────────────────
async function saveModuleBoundary(moduleName, allowedImports, forbiddenImports, description) {
  const mem = await initArchMemory();
  const existing = mem.moduleBoundaries.findIndex(b => b.module === moduleName);
  const rule = {
    module: moduleName,
    allowedImports: allowedImports || [],
    forbiddenImports: forbiddenImports || [],
    description: description || '',
    timestamp: Date.now(),
  };
  if (existing >= 0) {
    mem.moduleBoundaries[existing] = rule;
  } else {
    mem.moduleBoundaries.push(rule);
  }
  await saveArchMemory(mem);
  return rule;
}

// ─── Set tech stack ─────────────────────────────────────────
async function setTechStack(stack) {
  const mem = await initArchMemory();
  Object.assign(mem.techStack, stack);
  await saveArchMemory(mem);
  return mem.techStack;
}

// ─── Query architecture memory ──────────────────────────────
async function queryArchMemory(query) {
  const mem = await initArchMemory();
  const q = query.toLowerCase();
  const results = [];

  // Search tech stack keys + values
  for (const [key, val] of Object.entries(mem.techStack)) {
    if (key.toLowerCase().includes(q) || String(val).toLowerCase().includes(q)) {
      results.push(`Tech Stack — ${key}: ${val}`);
    }
  }

  // Search module boundaries
  for (const b of mem.moduleBoundaries) {
    if (b.module.toLowerCase().includes(q) || b.description.toLowerCase().includes(q)) {
      results.push(`Module Boundary — ${b.module}: ${b.description}`);
    }
  }

  // Search conventions
  for (const c of mem.codingConventions) {
    if (c.rule.toLowerCase().includes(q) || c.scope.toLowerCase().includes(q)) {
      results.push(`Convention — [${c.scope}] ${c.rule}`);
    }
  }

  // Search ADRs
  for (const a of mem.architectureDecisions) {
    if (a.decision.toLowerCase().includes(q) || a.reason.toLowerCase().includes(q)) {
      results.push(`ADR ${a.id}: ${a.decision} — ${a.reason.slice(0, 100)}`);
    }
  }

  return results.length > 0 ? results.join('\n') : `// No architecture records matching "${query}"`;
}

// ─── Check if a file path violates module boundaries ─────────
async function checkArchViolation(filePath) {
  const mem = await initArchMemory();
  if (mem.moduleBoundaries.length === 0) return null;

  const pathLower = filePath.toLowerCase();
  const violations = [];

  for (const boundary of mem.moduleBoundaries) {
    // Check if this file belongs to the module
    const inModule = boundary.allowedImports.some(alias =>
      pathLower.startsWith(alias.toLowerCase().replace(/\\/g, '/').replace(/\/$/, ''))
    );
    if (!inModule) continue;

    // Check if file imports from forbidden modules
    // (This is a best-effort check — real enforcement needs AST parsing)
    for (const forbidden of boundary.forbiddenImports) {
      violations.push({
        module: boundary.module,
        file: filePath,
        issue: `File in '${boundary.module}' may import from forbidden module '${forbidden}'. ${boundary.description}`,
      });
    }
  }

  return violations.length > 0 ? violations.map(v => `[ARCH VIOLATION] ${v.issue}`).join('\n') : null;
}

// ─── File Ownership ─────────────────────────────────────────
async function setFileOwnership(pattern, owner, description) {
  const mem = await initArchMemory();
  const existing = mem.fileOwnership.findIndex(o => o.pattern === pattern);
  const entry = { pattern, owner, description: description || '', timestamp: Date.now() };
  if (existing >= 0) mem.fileOwnership[existing] = entry;
  else mem.fileOwnership.push(entry);
  await saveArchMemory(mem);
  return entry;
}

async function checkOwnership(filePath, agentId) {
  const mem = await initArchMemory();
  const agent = typeof agents !== 'undefined' ? agents.find(a => a.id === agentId) : null;
  if (!agent) return null;
  for (const rule of mem.fileOwnership) {
    const pattern = rule.pattern.replace(/\*/g, '.*').replace(/\\/g, '/');
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (new RegExp('^' + pattern + '$', 'i').test(normalizedPath)) {
      if (rule.owner !== agentId && rule.owner !== agent.name) {
        return `[OWNERSHIP VIOLATION] "${filePath}" is owned by ${rule.owner}, but ${agent.name} (${agentId}) modified it.`;
      }
    }
  }
  return null;
}

// ─── Tech Debt Registry ─────────────────────────────────────
async function addTechDebt(description, severity, location, author) {
  const mem = await initArchMemory();
  const debt = {
    id: 'DEBT-' + Date.now().toString(36).toUpperCase(),
    description,
    severity: severity || 'medium',
    location: location || '',
    author: author || 'system',
    created: new Date().toISOString(),
    status: 'open',
  };
  mem.techDebt.push(debt);
  await saveArchMemory(mem);
  return debt;
}

async function getTechDebts(filterStatus) {
  const mem = await initArchMemory();
  let debts = mem.techDebt;
  if (filterStatus) debts = debts.filter(d => d.status === filterStatus);
  return debts.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return (order[a.severity] || 2) - (order[b.severity] || 2);
  });
}

// ─── Schema / Contract Registry ─────────────────────────────
async function saveSchema(name, fields, description, version) {
  const mem = await initArchMemory();
  const existing = mem.schemaRegistry.findIndex(s => s.name === name);
  const schema = {
    name,
    version: version || (existing >= 0 ? mem.schemaRegistry[existing].version + 1 : 1),
    fields: Array.isArray(fields) ? fields : (typeof fields === 'string' ? JSON.parse(fields) : []),
    description: description || '',
    consumers: existing >= 0 ? mem.schemaRegistry[existing].consumers : [],
    updatedAt: Date.now(),
  };
  if (existing >= 0) mem.schemaRegistry[existing] = schema;
  else mem.schemaRegistry.push(schema);
  await saveArchMemory(mem);
  return schema;
}

async function addSchemaConsumer(schemaName, filePath) {
  const mem = await initArchMemory();
  const schema = mem.schemaRegistry.find(s => s.name === schemaName);
  if (!schema) return { ok: false, message: `Schema "${schemaName}" not found` };
  if (!schema.consumers.includes(filePath)) {
    schema.consumers.push(filePath);
    await saveArchMemory(mem);
  }
  return { ok: true, message: `Registered ${filePath} as consumer of ${schemaName}` };
}

async function checkSchemaImpact(schemaName, changedFields) {
  const mem = await initArchMemory();
  const schema = mem.schemaRegistry.find(s => s.name === schemaName);
  if (!schema) return { found: false, message: `Schema "${schemaName}" not found` };
  const fieldNames = schema.fields.map(f => typeof f === 'string' ? f : (f.name || ''));
  const changes = (changedFields || '').split(',').map(s => s.trim()).filter(Boolean);
  const impacted = [];
  for (const change of changes) {
    if (fieldNames.includes(change)) {
      impacted.push({ field: change, action: 'field changed', consumers: schema.consumers });
    } else if (!fieldNames.some(f => f.toLowerCase().includes(change.toLowerCase()))) {
      impacted.push({ field: change, action: 'new field added', consumers: [] });
    }
  }
  return {
    found: true,
    schema: schema.name,
    version: schema.version,
    fields: schema.fields,
    consumers: schema.consumers,
    impacted,
  };
}

async function getAllSchemas() {
  const mem = await initArchMemory();
  return mem.schemaRegistry;
}

// ─── File Locking (in-memory, prevents concurrent patch) ────
const fileLocks = {};  // path → { agentId, acquiredAt }

function acquireFileLock(path, agentId) {
  if (fileLocks[path]) {
    if (fileLocks[path].agentId === agentId) return { ok: true, message: `Already held by ${agentId}` };
    const elapsed = Date.now() - fileLocks[path].acquiredAt;
    return { ok: false, message: `Lock held by ${fileLocks[path].agentId} for ${Math.round(elapsed / 1000)}s` };
  }
  fileLocks[path] = { agentId, acquiredAt: Date.now() };
  return { ok: true, message: `Lock acquired on ${path}` };
}

function releaseFileLock(path, agentId) {
  if (!fileLocks[path]) return { ok: false, message: `No lock on ${path}` };
  if (fileLocks[path].agentId !== agentId) return { ok: false, message: `Lock owned by ${fileLocks[path].agentId}, not ${agentId}` };
  delete fileLocks[path];
  return { ok: true, message: `Lock released on ${path}` };
}

function checkFileLock(path) {
  return fileLocks[path] || null;
}

// ─── Ownership Escalation ───────────────────────────────────
const escalationRequests = {};  // id → { requester, targetOwner, filePath, reason, status }

function requestEscalation(requesterId, targetOwnerId, filePath, reason) {
  const id = 'ESC-' + Date.now().toString(36).toUpperCase();
  escalationRequests[id] = {
    id, requester: requesterId, targetOwner: targetOwnerId,
    filePath, reason, status: 'pending',
    createdAt: Date.now(),
  };
  return escalationRequests[id];
}

function resolveEscalation(id, approved) {
  if (!escalationRequests[id]) return null;
  escalationRequests[id].status = approved ? 'approved' : 'denied';
  return escalationRequests[id];
}

function getPendingEscalations(agentId) {
  return Object.values(escalationRequests).filter(r =>
    r.status === 'pending' && r.targetOwner === agentId
  );
}

// ─── Symbol Graph Builder ───────────────────────────────────
async function buildSymbolGraph(paths) {
  const graph = { symbols: {}, imports: {} };
  const scanPaths = Array.isArray(paths) ? paths : (paths ? [paths] : []);
  for (const basePath of scanPaths) {
    try {
      const resp = await fetch(`/api/list?path=${encodeURIComponent(basePath)}&recursive=true`);
      const entries = await resp.json();
      if (!Array.isArray(entries)) continue;
      for (const entry of entries.slice(0, 50)) {
        if (entry.type === 'dir') continue;
        try {
          const fileResp = await fetch(`/api/read?path=${encodeURIComponent(entry.path)}`);
          const fileData = await fileResp.json();
          if (fileData.error || !fileData.content) continue;
          const content = fileData.content;
          const lines = content.split('\n');
          // Extract exports/definitions
          const symbols = [];
          const imports = [];
          for (const line of lines) {
            const def = line.match(/^(?:export\s+)?(?:function|class|const|let|var)\s+(\w+)/);
            if (def) symbols.push({ name: def[1], line: lines.indexOf(line) + 1 });
            const imp = line.match(/(?:import|require)\s*[({]?\s*([\w*{},\s]+)\s*(?:from\s+["']([^"']+)|require\s*\(\s*["']([^"']+))/);
            if (imp) imports.push({ source: imp[2] || imp[3] || 'unknown' });
          }
          graph.symbols[entry.path] = symbols;
          graph.imports[entry.path] = imports;
        } catch (e) { continue; }
      }
    } catch (e) { continue; }
  }
  return graph;
}

// ─── Get full architecture summary (readable) ────────────────
async function archSummary() {
  const mem = await initArchMemory();
  const lines = [];
  lines.push('=== TECH STACK ===');
  for (const [k, v] of Object.entries(mem.techStack)) {
    lines.push(`  ${k}: ${v}`);
  }
  if (mem.moduleBoundaries.length > 0) {
    lines.push('\n=== MODULE BOUNDARIES ===');
    for (const b of mem.moduleBoundaries) {
      lines.push(`  ${b.module}:`);
      if (b.allowedImports.length > 0) lines.push(`    allowed: ${b.allowedImports.join(', ')}`);
      if (b.forbiddenImports.length > 0) lines.push(`    forbidden: ${b.forbiddenImports.join(', ')}`);
      if (b.description) lines.push(`    ${b.description}`);
    }
  }
  if (mem.codingConventions.length > 0) {
    lines.push('\n=== CODING CONVENTIONS ===');
    for (const c of mem.codingConventions) {
      lines.push(`  [${c.scope}] ${c.rule}`);
    }
  }
  if (mem.architectureDecisions.length > 0) {
    lines.push('\n=== ARCHITECTURE DECISIONS ===');
    for (const a of mem.architectureDecisions.slice(-10)) {
      lines.push(`  ${a.id} (${a.date.slice(0, 10)}): ${a.decision}`);
    }
  }
  if (mem.fileOwnership.length > 0) {
    lines.push('\n=== FILE OWNERSHIP ===');
    for (const o of mem.fileOwnership) {
      lines.push(`  ${o.pattern} → ${o.owner}  ${o.description ? `(${o.description})` : ''}`);
    }
  }
  if (mem.techDebt.length > 0) {
    const open = mem.techDebt.filter(d => d.status === 'open');
    if (open.length > 0) {
      lines.push(`\n=== TECH DEBT (${open.length} open) ===`);
      for (const d of open.slice(0, 10)) {
        lines.push(`  [${d.severity}] ${d.id}: ${d.description.slice(0, 80)} (${d.location})`);
      }
    }
  }
  if (mem.schemaRegistry.length > 0) {
    lines.push('\n=== SCHEMA REGISTRY ===');
    for (const s of mem.schemaRegistry) {
      const fields = s.fields.map(f => typeof f === 'string' ? f : (f.name || '')).join(', ');
      lines.push(`  ${s.name} v${s.version}: {${fields}}`);
      if (s.consumers.length > 0) lines.push(`    consumers: ${s.consumers.join(', ')}`);
    }
  }
  return lines.join('\n');
}
