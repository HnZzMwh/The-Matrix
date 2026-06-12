// ============================================================
// TOOLS — Agent tool execution engine (Plugin-based)
// ============================================================

const EA = (typeof window !== 'undefined' && window.electronAPI) ? window.electronAPI : null;

// ─── IPC Helpers ───────────────────────────────────────────
async function ipcRead(path) {
  if (!EA) return { error: 'Electron API not available' };
  try { return await EA.fs.read(path); } catch (e) { return { error: e.message }; }
}
async function ipcReadSafe(path) {
  if (!EA) return { error: 'Electron API not available' };
  try { return await EA.fs.readSafe(path); } catch (e) { return { error: e.message }; }
}
async function ipcWrite(path, content) {
  if (!EA) return { error: 'Electron API not available' };
  try { return await EA.fs.write(path, content); } catch (e) { return { error: e.message }; }
}
async function ipcWriteSafe(path, content) {
  if (!EA) return { error: 'Electron API not available' };
  try { return await EA.fs.writeSafe(path, content); } catch (e) { return { error: e.message }; }
}
async function ipcList(path, recursive) {
  if (!EA) return { error: 'Electron API not available' };
  try { return await EA.fs.list(path, recursive); } catch (e) { return { error: e.message }; }
}
async function ipcSearch(query, roots) {
  if (!EA) return { error: 'Electron API not available' };
  try { return await EA.fs.search(query, roots || ''); } catch (e) { return { error: e.message }; }
}
async function ipcRun(cmd, cwd, capability) {
  if (!EA) return { error: 'Electron API not available' };
  try { return await EA.fs.run(cmd, cwd || '', capability || 'build'); } catch (e) { return { error: e.message }; }
}

// ─── Compatibility Helpers ──────────────────────────────────
async function readPath(path) { return await ipcRead(path); }
async function listPath(path, recursive) { return await ipcList(path, recursive); }

// ─── Regex helper ───────────────────────────────────────────
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Test log (shared across plugins) ───────────────────────
const TEST_LOG = [];

function testReport() {
  if (TEST_LOG.length === 0) return '// No tests have been run yet.';
  const passed = TEST_LOG.filter(t => t.passed).length;
  const total = TEST_LOG.length;
  return `📊 Test Report: ${passed}/${total} passed (${Math.round(passed/total*100)}%)\n` +
    TEST_LOG.map(t => `  ${t.passed ? '✓' : '✗'} ${t.name}`).join('\n');
}

// ─── Tool dispatcher ────────────────────────────────────────
function extractToolCalls(text) {
  // Prefer [/TOOL] as closing delimiter (supports ] in content), fallback to ]
  const re = /\[TOOL:\s*(\w+)\s*([\s\S]*?)\s*\[\/TOOL\]|\[TOOL:\s*(\w+)\s*([^\]]*)\]/g;
  const calls = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1] || m[3];
    const argsStr = m[2] || m[4] || '';
    const args = {};
    // Double-quoted values (supports newlines, escaped quotes)
    const dqRe = /(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
    let am;
    while ((am = dqRe.exec(argsStr)) !== null) {
      args[am[1]] = am[2].replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\(.)/g, '$1');
    }
    // Single-quoted values (supports newlines, escaped quotes)
    const sqRe = /(\w+)\s*=\s*'((?:[^'\\]|\\.)*)'/g;
    while ((am = sqRe.exec(argsStr)) !== null) {
      args[am[1]] = am[2].replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\(.)/g, '$1');
    }
    // Fallback for unnamed args
    if (Object.keys(args).length === 0 && argsStr.trim()) {
      args._ = argsStr.trim().replace(/^"(.*)"$/, '$1');
    }
    calls.push({ name, args });
  }
  return calls;
}

async function executeToolCall(tc, agentId, agentName) {
  console.log(`[TOOLS] ${agentName} calling ${tc.name}`, tc.args);

  // ── ToolGuard: rate limit + path safety + content size ──
  if (typeof ToolGuard !== 'undefined' && ToolGuard.validateToolCall) {
    const guardCheck = ToolGuard.validateToolCall(tc.name, tc.args || {}, agentId);
    if (!guardCheck.allowed) {
      console.warn(`[ToolGuard] BLOCKED ${agentName} → ${tc.name}: ${guardCheck.reason}`);
      return `\n<<TOOL ${tc.name} FAILED>>\n// GUARD: ${guardCheck.reason}\n<</TOOL ${tc.name}>>`;
    }
  }

  // ── Guardrails: pre-write content check ──
  if (tc.name === 'write_file' && typeof Guardrails !== 'undefined' && Guardrails.checkWriteContent) {
    const writeCheck = Guardrails.checkWriteContent(tc.args.content);
    if (!writeCheck.safe) {
      const findings = writeCheck.findings.map(f => `${f.label}(${f.snippet})`).join(', ');
      console.warn(`[Guardrails] BLOCKED write_file: ${findings}`);
      return `\n<<TOOL write_file FAILED>>\n// GUARDRAILS: Hardcoded secrets detected: ${findings}\n// Use environment variables instead of hardcoded keys.\n<</TOOL write_file>>`;
    }
  }

  // ── Guardrails: critical write confirmation ──
  if ((tc.name === 'write_file' || tc.name === 'patch_file') && typeof Guardrails !== 'undefined' && Guardrails.checkCriticalWrite) {
    const critCheck = Guardrails.checkCriticalWrite(tc.args.path);
    if (critCheck.critical) {
      // Skip confirmation if already confirmed in this session
      // Use Map with TTL to prevent unbounded growth
      if (!window._confirmedCriticalWrites) {
        window._confirmedCriticalWrites = new Map();
      }
      const confirmKey = `critical_write_${agentId}_${tc.args.path}`;
      const cached = window._confirmedCriticalWrites.get(confirmKey);
      if (!cached || (Date.now() - cached) > 5 * 60 * 1000) { // 5 min expiry
        const ok = confirm(`⚠️ Agent ${agentName} wants to write to: ${tc.args.path}\nType: ${critCheck.label} (critical)\n\nAllow this write?`);
        if (!ok) {
          return `\n<<TOOL ${tc.name} FAILED>>\n// GUARDRAILS: Critical file write denied by user: ${tc.args.path}\n<</TOOL ${tc.name}>>`;
        }
        window._confirmedCriticalWrites.set(confirmKey, Date.now());
        // Evict stale entries older than 30 minutes
        const now = Date.now();
        for (const [k, v] of window._confirmedCriticalWrites) {
          if (now - v > 30 * 60 * 1000) window._confirmedCriticalWrites.delete(k);
        }
      }
    }
  }

  const result = await window.pluginManager.execute(tc.name, tc.args);

  if (typeof result === 'object' && result !== null && result.images) {
    return result;
  }

  // ── Guardrails: post-execution tool output check ──
  let finalResult = result;
  if (typeof Guardrails !== 'undefined' && Guardrails.checkToolOutput) {
    const toolCheck = Guardrails.checkToolOutput(tc.name, result);
    if (!toolCheck.safe) {
      console.warn(`[Guardrails] Redacted secrets from tool ${tc.name} output`);
    }
    finalResult = toolCheck.sanitized;
  }

  const isError = typeof finalResult === 'string' && (finalResult.startsWith('// ERROR') || finalResult.startsWith('// BLOCKED'));

  // Log history
  if (typeof saveHistory === 'function') {
    saveHistory({
      timestamp: Date.now(),
      agentId,
      agentName,
      toolName: tc.name,
      filePath: tc.args.path || tc.args.file || '',
      result: typeof finalResult === 'string' ? finalResult.slice(0, 100) : 'object'
    });
  }

  const status = isError ? 'FAILED' : 'SUCCESS';
  return `\n<<TOOL ${tc.name} ${status}>>\n${finalResult}\n<</TOOL ${tc.name}>>`;
}

// Re-export tools as legacy global for compatibility if needed
const TOOL_DEFS = {}; // No longer primary, plugins fill pluginManager.tools
