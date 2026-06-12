/**
 * GUARDRAILS — Output safety & content integrity checks
 *
 * Checks applied at multiple points in the agent pipeline:
 *   1. Agent output → scan for leaked secrets, sensitive paths
 *   2. write_file content → scan for hardcoded API keys before writing
 *   3. Critical file write → require explicit user confirmation
 */

// ─── Secret / Key patterns ──────────────────────────────────────

const SECRET_PATTERNS = [
  // OpenAI / Claude API keys
  { pattern: /sk-(?:proj-)?[A-Za-z0-9]{20,}/gi, label: 'API Key (sk-*)' },
  { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/gi, label: 'Anthropic API Key' },
  // GitHub tokens
  { pattern: /gh[po]_[A-Za-z0-9]{36,}/gi, label: 'GitHub Token' },
  { pattern: /github_pat_[A-Za-z0-9_]{30,}/gi, label: 'GitHub PAT' },
  // Generic key assignment patterns
  { pattern: /(?:api[_-]?key|apikey|api[_-]?secret|access[_-]?key|secret[_-]?key)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/gi, label: 'Hardcoded API key assignment' },
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{6,}['"]/gi, label: 'Hardcoded password' },
  { pattern: /(?:token|auth)\s*[:=]\s*['"][A-Za-z0-9_\-\.]{20,}['"]/gi, label: 'Hardcoded token' },
  // JWT tokens (eyJ...)
  { pattern: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/gi, label: 'JWT token' },
  // Private key headers
  { pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/gi, label: 'Private key' },
  // AWS credentials
  { pattern: /AKIA[0-9A-Z]{16}/gi, label: 'AWS Access Key' },
];

// ─── Sensitive path patterns in agent output ────────────────────

const SENSITIVE_OUTPUT_PATTERNS = [
  // System paths
  { pattern: /(?:\/etc\/(?:passwd|shadow|sudoers|hosts))|(?:C:\\Windows\\System32)/gi, label: 'System file reference' },
  // Home directory leaks
  { pattern: /(?:\/home\/\w+|\/Users\/\w+)\/(?:\.ssh|\.aws|\.gnupg|\.config)/gi, label: 'Sensitive directory reference' },
  // Credential files
  { pattern: /\.env(?:\.\w+)?\b/gi, label: '.env file reference' },
  // IPs + ports that look like internal addresses
  { pattern: /(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})/gi, label: 'Private IP address' },
];

// ─── Tool content check (pre-write_file) ────────────────────────

function checkWriteContent(content) {
  if (!content || typeof content !== 'string') return { safe: true, findings: [] };

  const findings = [];

  for (const entry of SECRET_PATTERNS) {
    entry.pattern.lastIndex = 0;
    const matches = content.match(entry.pattern);
    if (matches && matches.length > 0) {
      findings.push({
        type: 'secret',
        label: entry.label,
        count: matches.length,
        snippet: matches[0].slice(0, 40),
      });
    }
  }

  return {
    safe: findings.length === 0,
    findings,
  };
}

// ─── Agent output check (post-reply) ────────────────────────────

function checkAgentOutput(text) {
  if (!text || typeof text !== 'string') return { safe: true, findings: [], sanitized: text };

  const findings = [];
  let sanitized = text;

  // ── Secret leaks ──
  for (const entry of SECRET_PATTERNS) {
    entry.pattern.lastIndex = 0;
    const matches = text.match(entry.pattern);
    if (matches && matches.length > 0) {
      findings.push({
        type: 'secret_leak',
        label: entry.label,
        count: matches.length,
        snippet: matches[0].slice(0, 20) + '...',
      });
      // Redact in output
      sanitized = sanitized.replace(entry.pattern, (m) => `[REDACTED:${entry.label}]`);
    }
  }

  // ── Sensitive paths ──
  for (const entry of SENSITIVE_OUTPUT_PATTERNS) {
    entry.pattern.lastIndex = 0;
    const matches = text.match(entry.pattern);
    if (matches && matches.length > 0) {
      findings.push({
        type: 'sensitive_path',
        label: entry.label,
        count: matches.length,
        snippet: matches[0].slice(0, 40),
      });
    }
  }

  return {
    safe: findings.length === 0,
    findings,
    sanitized,
  };
}

// ─── Critical write check ──────────────────────────────────────

const CRITICAL_WRITE_PATTERNS = [
  // Config files that could break the system
  { pattern: /(?:webpack|vite|rollup|eslint|prettier|tsconfig|babel)\.config\.(?:js|ts|mjs|cjs|json)$/i, label: 'Build config' },
  { pattern: /CMakeLists\.txt$/i, label: 'CMake config' },
  { pattern: /Dockerfile$/i, label: 'Docker config' },
  { pattern: /docker-compose\.ya?ml$/i, label: 'Docker compose' },
  { pattern: /\.github\/workflows\//i, label: 'CI workflow' },
  { pattern: /Makefile$/i, label: 'Makefile' },
];

/**
 * Check if writing to this file requires user confirmation.
 * Returns { critical: boolean, label: string }
 */
function checkCriticalWrite(path) {
  if (!path) return { critical: false, label: '' };
  for (const entry of CRITICAL_WRITE_PATTERNS) {
    if (entry.pattern.test(path)) {
      return { critical: true, label: entry.label };
    }
  }
  return { critical: false, label: '' };
}

// ─── Tool output check (post-execution) ────────────────────────

function checkToolOutput(toolName, output) {
  if (!output || typeof output !== 'string') return { safe: true, findings: [], sanitized: output };

  const findings = [];
  let sanitized = output;

  // Secret leaks in tool output
  for (const entry of SECRET_PATTERNS) {
    entry.pattern.lastIndex = 0;
    if (entry.pattern.test(output)) {
      findings.push({
        type: 'secret_in_tool_output',
        label: entry.label,
        tool: toolName,
      });
      entry.pattern.lastIndex = 0;
      sanitized = sanitized.replace(entry.pattern, (m) => `[REDACTED:${entry.label}]`);
    }
  }

  return { safe: findings.length === 0, findings, sanitized };
}

// ─── Expose globally ───────────────────────────────────────────

window.Guardrails = {
  checkWriteContent,
  checkAgentOutput,
  checkCriticalWrite,
  checkToolOutput,
  SECRET_PATTERNS,
  SENSITIVE_OUTPUT_PATTERNS,
  CRITICAL_WRITE_PATTERNS,
};
