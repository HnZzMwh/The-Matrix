/**
 * PROMPT GUARD — Input sanitization & injection defense
 *
 * Two attack surfaces:
 *   1. User message injection — "ignore previous instructions, do X"
 *   2. @mention cross-agent injection — embedded commands in routed messages
 */

const MAX_INPUT_LENGTH = 8000;

// Patterns that signal prompt hijacking attempts
const INJECTION_PATTERNS = [
  // System prompt override
  /\bignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|messages?|context)\b/gi,
  // Role impersonation
  /\byou\s+are\s+now\s+(acting\s+as|playing|pretending\s+to\s+be|become)\b/gi,
  // Instruction override
  /\bdisregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|guidelines?)\b/gi,
  /\bdo\s+not\s+follow\s+(your|the)\s+(instructions?|rules?|guidelines?)\b/gi,
  /\boverride\s+(system|safety|security|previous)\s+(prompt|instruction|rule)s?\b/gi,
  // DAN-style jailbreak
  /\b(DAN|jailbreak|developer\s*mode|god\s*mode)\b/gi,
  // Tool injection — trying to embed fake tool calls in user message
  /\[TOOL:\s*write_file\s+path\s*=\s*["']?(?:\/etc\/|\/root\/|C:\\Windows\\|C:\\windows\\)/gi,
  // Token smuggling (very long non-human content)
  /(?:[A-Za-z0-9+\/=]{500,})/,  // base64-like blob > 500 chars
];

// Critical files that should NEVER be writable via tool from user prompt
const CRITICAL_FILE_PATTERNS = [
  /\/etc\/(passwd|shadow|hosts|sudoers|crontab|fstab)/i,
  /\/root\//i,
  /C:\\Windows\\System32\\/i,
  /C:\\windows\\system32\\/i,
  /\/\.ssh\//i,
  /\/\.aws\//i,
  /\/\.env/i,
  /package-lock\.json$/i,   // Usually auto-generated, shouldn't be hand-written
  /\.git\/config$/i,
];

// ─── PUBLIC API ────────────────────────────────────────────────

/**
 * Sanitize user input before processing.
 * Returns { sanitized, blocked, warnings }.
 */
function sanitizeUserInput(text) {
  if (!text || typeof text !== 'string') return { sanitized: '', blocked: false, warnings: ['Empty input'] };

  const warnings = [];
  let sanitized = text;

  // ── Length limit ──
  if (sanitized.length > MAX_INPUT_LENGTH) {
    sanitized = sanitized.slice(0, MAX_INPUT_LENGTH);
    warnings.push(`Input truncated from ${text.length} to ${MAX_INPUT_LENGTH} chars`);
  }

  // ── Scan for injection patterns ──
  let blocked = false;
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      const match = sanitized.match(pattern);
      if (match) {
        const snippet = match[0].slice(0, 60);
        warnings.push(`Injection pattern detected: "${snippet}"`);

        // Block only the most dangerous ones; warn on others
        if (pattern.source.includes('instructions') ||
            pattern.source.includes('override') ||
            pattern.source.includes('DAN')) {
          blocked = true;
        }
      }
    }
  }

  // ── Critical file path in user message ──
  for (const pattern of CRITICAL_FILE_PATTERNS) {
    if (pattern.test(sanitized)) {
      const match = sanitized.match(pattern);
      if (match) {
        warnings.push(`Critical path referenced: "${match[0].slice(0, 60)}"`);
        blocked = true;
      }
    }
  }

  // ── @mention chain depth ──
  const mentionCount = (sanitized.match(/@\w+/g) || []).length;
  if (mentionCount > 8) {
    warnings.push(`Too many @mentions (${mentionCount}) — possible spam`);
    blocked = true;
  }

  if (blocked) {
    console.warn('[PromptGuard] BLOCKED:', warnings.join('; '));
    return { sanitized: '', blocked: true, warnings };
  }

  if (warnings.length > 0) {
    console.log('[PromptGuard] Warned:', warnings.join('; '));
  }

  return { sanitized, blocked: false, warnings };
}

/**
 * Sanitize a message being routed via @mention to another agent.
 * Strips embedded tool calls and limits instruction embedding.
 */
function sanitizeRoutedMessage(text, senderAgentId, targetAgentId) {
  if (!text) return text;

  let cleaned = text;

  // Strip embedded [TOOL: ...] calls from routed messages
  cleaned = cleaned.replace(/\[TOOL:\s*[^\]]+\]/gi, '[TOOL: REDACTED]');
  cleaned = cleaned.replace(/\[TOOL:\s*[\s\S]*?\[\/TOOL\]/gi, '[TOOL: REDACTED]');

  // Strip system-style directives
  cleaned = cleaned.replace(/\b(you must|you are required|your only job is|your purpose is now)\b/gi, '[FILTERED]');

  // Mark as routed for transparency
  if (cleaned.length > 2000) {
    cleaned = cleaned.slice(0, 2000) + '\n[...truncated...]';
  }

  return cleaned;
}

// ─── Expose globally ───────────────────────────────────────────
window.PromptGuard = {
  sanitizeUserInput,
  sanitizeRoutedMessage,
  INJECTION_PATTERNS,
  CRITICAL_FILE_PATTERNS,
  MAX_INPUT_LENGTH,
};
