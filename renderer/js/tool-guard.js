/**
 * TOOL GUARD — Rate limiting + content safety for tool execution
 *
 * Hooks into PluginManager.execute() to enforce:
 *   1. Rate limits per agent/tool pair (20 calls / 30s window)
 *   2. Content size limits (500KB max)
 *   3. Critical file path blocking on write_file
 *   4. Run_command capability re-validation
 */

const TOOL_WINDOW_MS = 30000;       // 30-second rate window
const TOOL_MAX_PER_WINDOW = 20;      // Max calls per tool per window
const CONTENT_MAX_BYTES = 500000;    // 500KB max content size
const TOOL_TOTAL_MAX_PER_WINDOW = 100; // Total tool calls per agent per window

// Critical paths that write_file should NEVER touch
const WRITE_BLOCKED_PATHS = [
  /^\/etc\//i, /^\/root\//i, /^\/boot\//i, /^\/sys\//i, /^\/proc\//i, /^\/dev\//i,
  /^C:\\Windows\\/i, /^C:\\windows\\/i,
  /^C:\\Program Files\\/i, /^C:\\program files\\/i,
  /\/\.ssh\//i, /\/\.aws\//i, /\/\.gnupg\//i,
  /\/\.git\/config$/i, /\/\.gitconfig$/i,
  /\/\.env$/i, /\/\.env\.[a-z]+$/i,
  /\/package-lock\.json$/i,
  /\/yarn\.lock$/i,
];

// Rate-limit state per agent
const rateState = new Map(); // agentId → { tools: Map<toolName, timestamps[]>, totalTimestamps[] }

function _ensureState(agentId) {
  if (!rateState.has(agentId)) {
    rateState.set(agentId, { tools: new Map(), totalTimestamps: [] });
  }
  return rateState.get(agentId);
}

function _checkRateLimit(agentId, toolName) {
  const state = _ensureState(agentId);
  const now = Date.now();

  // Per-tool check
  if (!state.tools.has(toolName)) {
    state.tools.set(toolName, []);
  }
  const toolHistory = state.tools.get(toolName);
  // Prune expired
  while (toolHistory.length > 0 && now - toolHistory[0] > TOOL_WINDOW_MS) {
    toolHistory.shift();
  }
  if (toolHistory.length >= TOOL_MAX_PER_WINDOW) {
    return { allowed: false, reason: `Rate limit: ${toolName} called ${toolHistory.length} times in ${TOOL_WINDOW_MS / 1000}s (max ${TOOL_MAX_PER_WINDOW})` };
  }

  // Total per-agent check
  while (state.totalTimestamps.length > 0 && now - state.totalTimestamps[0] > TOOL_WINDOW_MS) {
    state.totalTimestamps.shift();
  }
  if (state.totalTimestamps.length >= TOOL_TOTAL_MAX_PER_WINDOW) {
    return { allowed: false, reason: `Global rate limit: ${state.totalTimestamps.length} total tool calls in ${TOOL_WINDOW_MS / 1000}s` };
  }

  // Record
  toolHistory.push(now);
  state.totalTimestamps.push(now);

  // Cleanup old agent state (5 min idle → remove)
  if (now - state.totalTimestamps[state.totalTimestamps.length - 1] > 300000 && state.totalTimestamps.length < 3) {
    rateState.delete(agentId);
  }

  return { allowed: true };
}

function _checkWritePath(path) {
  if (!path) return { allowed: true };
  for (const pattern of WRITE_BLOCKED_PATHS) {
    if (pattern.test(path)) {
      return { allowed: false, reason: `Blocked write to critical path: ${path}` };
    }
  }
  return { allowed: true };
}

function _checkContentSize(args) {
  const content = args.content || args.text || args.data || '';
  if (typeof content === 'string' && content.length > CONTENT_MAX_BYTES) {
    return { allowed: false, reason: `Content too large: ${content.length} bytes (max ${CONTENT_MAX_BYTES})` };
  }
  return { allowed: true };
}

function _checkRunCommand(args) {
  const cmd = args.cmd || args.command || '';
  // Re-validate shell characters (belt-and-suspenders with main.js sandbox)
  const SHELL_CHARS = [';', '|', '&&', '||', '`', '$', '>', '<', '&', '(', ')', '{', '}'];
  for (const ch of SHELL_CHARS) {
    if (cmd.includes(ch)) {
      return { allowed: false, reason: `Shell injection blocked: char "${ch}" in command` };
    }
  }
  // Block dangerous commands even without shell chars
  const DANGEROUS_COMMANDS = ['rm -rf', 'dd if=', 'mkfs', ':(){', 'chmod 777', 'sudo ', 'su '];
  for (const dc of DANGEROUS_COMMANDS) {
    if (cmd.toLowerCase().includes(dc)) {
      return { allowed: false, reason: `Dangerous command blocked: "${dc}"` };
    }
  }
  return { allowed: true };
}

// ─── PUBLIC API ────────────────────────────────────────────────

/**
 * Validate a tool call before execution.
 * @param {string} toolName
 * @param {object} args
 * @param {string} agentId
 * @returns {{allowed: boolean, reason?: string}}
 */
function validateToolCall(toolName, args, agentId) {
  // ── Rate limit ──
  const rateCheck = _checkRateLimit(agentId, toolName);
  if (!rateCheck.allowed) return rateCheck;

  // ── Tool-specific checks ──
  if (toolName === 'write_file' || toolName === 'patch_file') {
    const pathCheck = _checkWritePath(args.path);
    if (!pathCheck.allowed) return pathCheck;
  }

  if (toolName === 'write_file' || toolName === 'patch_file' || toolName === 'save_checkpoint') {
    const sizeCheck = _checkContentSize(args);
    if (!sizeCheck.allowed) return sizeCheck;
  }

  if (toolName === 'run_command') {
    const cmdCheck = _checkRunCommand(args);
    if (!cmdCheck.allowed) return cmdCheck;
  }

  return { allowed: true };
}

/**
 * Get rate limit stats for debugging.
 */
function getToolGuardStats(agentId) {
  const state = rateState.get(agentId);
  if (!state) return { agentId, toolCounts: {}, total: 0 };
  const toolCounts = {};
  for (const [name, history] of state.tools) {
    toolCounts[name] = history.length;
  }
  return { agentId, toolCounts, total: state.totalTimestamps.length };
}

/**
 * Reset rate limit state (for testing / session reset).
 */
function resetToolGuard() {
  rateState.clear();
}

// ─── Expose globally ───────────────────────────────────────────
window.ToolGuard = {
  validateToolCall,
  getToolGuardStats,
  resetToolGuard,
  WRITE_BLOCKED_PATHS,
  TOOL_WINDOW_MS,
  TOOL_MAX_PER_WINDOW,
  CONTENT_MAX_BYTES,
};
