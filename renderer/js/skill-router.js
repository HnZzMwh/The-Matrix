/**
 * SKILL ROUTER — Two-stage recall & ranking for tool injection
 *
 * Problem: 57+ tools injected into every system prompt → token waste + noise
 * Solution: Intent extraction → Coarse recall (tag match) → Fine rank (dedup + sort) → Top-N
 *
 * Stage 1 (Coarse Recall): Match user-message keywords against tool tags
 *   - Always include tools from "always_on" categories (fs_read, fs_write)
 *   - Filter by category activation: categories with matched intent keywords get their tools included
 *   - Result: candidate tool set (typically 20-35 tools)
 *
 * Stage 2 (Fine Rank): Deduplicate overlapping tools + sort by relevance
 *   - Within each overlap_group, keep only top-K tools by priority
 *   - Score remaining tools by: tag_match_count * 10 + priority
 *   - Return Top-N (default 15) for prompt injection
 */

const SKILL_INDEX_PATH = 'data/skill-index.json';
const TOP_N_DEFAULT = 15;

class SkillRouter {
  constructor() {
    this.index = null;
    this.loaded = false;
  }

  async init() {
    if (this.loaded) return;
    try {
      this.index = await this._fetchIndex();
      this.loaded = true;
      console.log(`[SkillRouter] Index loaded: ${Object.keys(this.index.tools).length} tools, ${Object.keys(this.index.categories).length} categories`);
    } catch (e) {
      console.warn('[SkillRouter] Could not load index:', e);
      this.index = null;
    }
  }

  async _fetchIndex() {
    // Try fetch from filesystem (Electron), fallback to inline fetch
    const ea = window.electronAPI;
    if (ea?.store?.get) {
      const stored = await ea.store.get('skill_index');
      if (stored && stored.tools) return stored;
    }
    try {
      const resp = await fetch(SKILL_INDEX_PATH);
      if (resp.ok) return await resp.json();
    } catch {}
    // Fallback: build minimal index from pluginManager
    return this._buildFromPluginManager();
  }

  _buildFromPluginManager() {
    const pm = window.pluginManager;
    const tools = {};
    if (pm) {
      for (const [name, def] of pm.tools.entries()) {
        tools[name] = {
          desc: def.desc || '',
          tags: name.split('_'),
          category: 'unknown',
          overlap_group: null,
          priority: 5,
          boundary: null,
        };
      }
    }
    return { version: 'fallback', tools, categories: {}, overlap_rules: {}, intent_map: {} };
  }

  // ==============================================================
  // PUBLIC: Primary entry point
  // ==============================================================

  /**
   * Select the best tools for a given user message.
   * @param {string} userMessage - The user's latest message
   * @param {string} agentId - Agent context (future: per-agent skill customization)
   * @param {number} topN - Max tools to return (default 15)
   * @returns {string} Comma-separated tool list for prompt injection, e.g. "read_file, write_file, ..."
   */
  async selectTools(userMessage, agentId, topN = TOP_N_DEFAULT) {
    if (!this.loaded) await this.init();
    if (!this.index || !this.index.tools) {
      // Fallback: return all registered tools
      return this._fullListFallback();
    }

    const startTime = performance.now();

    // ── Stage 0: Extract intent keywords ──
    const intents = this._extractIntents(userMessage);
    const keywords = this._extractKeywords(userMessage, intents);

    // ── Stage 1: Coarse Recall ──
    const candidates = this._coarseRecall(keywords, intents);
    console.log(`[SkillRouter] Stage 1: ${candidates.size} candidates from ${Object.keys(intents).length} intents`);

    // ── Stage 2: Fine Rank ──
    const ranked = this._fineRank(candidates, keywords);
    const selected = ranked.slice(0, topN);

    const elapsed = (performance.now() - startTime).toFixed(1);
    const reduction = this.index.tools ? Math.round((1 - selected.length / Object.keys(this.index.tools).length) * 100) : 0;

    const toolList = selected.map(t => t.name).join(', ');
    console.log(`[SkillRouter] Stage 2: ${selected.length} tools (${reduction}% reduction) in ${elapsed}ms → ${toolList}`);

    // Persist selection stats for UI
    if (!window._routerStats) window._routerStats = {};
    window._routerStats.lastSelection = {
      totalInIndex: Object.keys(this.index.tools).length,
      candidates: candidates.size,
      selected: selected.length,
      reduction,
      intents: Object.keys(intents),
      tools: selected.map(t => t.name),
      elapsed,
      timestamp: Date.now(),
    };

    return toolList;
  }

  /**
   * Return the full tool list as comma-separated string (fallback mode).
   */
  _fullListFallback() {
    const pm = window.pluginManager;
    if (!pm) return '';
    return Array.from(pm.tools.keys()).join(', ');
  }

  // ==============================================================
  // STAGE 0: Intent Extraction
  // ==============================================================

  _extractIntents(userMessage) {
    const msg = (userMessage || '').toLowerCase();
    const intentMap = this.index.intent_map || {};
    const active = {};

    for (const [intent, triggers] of Object.entries(intentMap)) {
      let score = 0;
      for (const trigger of triggers) {
        if (trigger.includes(' ')) {
          // Multi-word trigger (Chinese or English phrases)
          if (msg.includes(trigger)) score += 3;
        } else if (/[\u4e00-\u9fff]/.test(trigger)) {
          // Chinese character trigger: use substring match (no \b for CJK)
          if (msg.includes(trigger)) score += 2;
        } else {
          // English single-word trigger: word boundary match
          const regex = new RegExp('\\b' + trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
          const matches = msg.match(regex);
          if (matches) score += matches.length * 2;
        }
      }
      if (score > 0) active[intent] = score;
    }

    // If no intents detected, activate "read_code" as default (most common)
    if (Object.keys(active).length === 0) {
      active.read_code = 1;
    }

    return active;
  }

  _extractKeywords(userMessage, intents) {
    const msg = (userMessage || '').toLowerCase();
    const words = new Set();

    // From intent keywords
    for (const intent of Object.keys(intents)) {
      const triggers = (this.index.intent_map || {})[intent] || [];
      for (const t of triggers) {
        words.add(t);
      }
    }

    // From user message: significant words (3+ chars, not stop words)
    const STOP_WORDS = new Set([
      'the', 'and', 'for', 'that', 'this', 'with', 'you', 'are', 'not', 'but',
      'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have',
      'from', 'they', 'will', 'would', 'there', 'their', 'what', 'about',
      'which', 'when', 'make', 'like', 'just', 'been', 'into', 'some', 'such',
      'than', 'then', 'them', 'very', 'also', 'your', 'here', 'more', 'other',
      'only', 'over', 'each', 'most', 'should', 'could', 'much', 'well',
    ])
    const msgWords = msg.split(/[\s,.;:!?()\[\]{}'"\\/]+/).filter(w => w.length >= 3);
    for (const w of msgWords) {
      if (w.length >= 3 && !STOP_WORDS.has(w)) words.add(w);
    }
    // For Chinese: also extract 2-char bigrams from continuous CJK spans
    const cjkSpan = msg.match(/[\u4e00-\u9fff]{2,}/g);
    if (cjkSpan) {
      for (const span of cjkSpan) {
        for (let i = 0; i <= span.length - 2; i++) {
          words.add(span.substring(i, i + 2));
        }
      }
    }

    return words;
  }

  // ==============================================================
  // STAGE 1: Coarse Recall
  // ==============================================================

  _coarseRecall(keywords, intents) {
    const candidates = new Set();
    const tools = this.index.tools || {};
    const categories = this.index.categories || {};
    const intentMap = this.index.intent_map || {};

    // Determine which categories are activated by intents
    const activatedCategories = new Set();

    // Always-active categories
    for (const [catName, catDef] of Object.entries(categories)) {
      if (catDef.always_on) activatedCategories.add(catName);
    }

    // Category → intent mapping (reverse index)
    // build a quick map: keyword → category (via tools)
    for (const [toolName, toolDef] of Object.entries(tools)) {
      for (const tag of toolDef.tags || []) {
        const tagLower = tag.toLowerCase();
        for (const intent of Object.keys(intents)) {
          const triggers = intentMap[intent] || [];
          if (triggers.some(t => t.toLowerCase() === tagLower || tagLower.includes(t.toLowerCase()) || t.toLowerCase().includes(tagLower))) {
            activatedCategories.add(toolDef.category);
            break;
          }
        }
      }
    }

    // Also activate categories by direct keyword→tag match
    for (const keyword of keywords) {
      for (const [, toolDef] of Object.entries(tools)) {
        for (const tag of toolDef.tags || []) {
          if (tag.toLowerCase() === keyword || keyword.includes(tag.toLowerCase()) || tag.toLowerCase().includes(keyword)) {
            activatedCategories.add(toolDef.category);
            break;
          }
        }
      }
    }

    // Select tools whose category is activated
    for (const [toolName, toolDef] of Object.entries(tools)) {
      if (activatedCategories.has(toolDef.category)) {
        candidates.add(toolName);
      }
    }

    // Always include fs_read and fs_write (absolute minimum for any coding task)
    for (const [toolName, toolDef] of Object.entries(tools)) {
      if (toolDef.category === 'fs_read' || toolDef.category === 'fs_write') {
        candidates.add(toolName);
      }
    }

    return candidates;
  }

  // ==============================================================
  // STAGE 2: Fine Rank
  // ==============================================================

  _fineRank(candidates, keywords) {
    const tools = this.index.tools || {};
    const overlapRules = this.index.overlap_rules || {};

    // Step 1: Score each candidate tool
    const scored = [];
    for (const toolName of candidates) {
      const toolDef = tools[toolName];
      if (!toolDef) continue;

      const tags = toolDef.tags || [];
      let tagScore = 0;

      // Count keyword matches against tags
      for (const keyword of keywords) {
        for (const tag of tags) {
          if (tag.toLowerCase() === keyword || keyword.includes(tag.toLowerCase()) || tag.toLowerCase().includes(keyword)) {
            tagScore++;
            break;
          }
        }
      }

      const score = tagScore * 10 + (toolDef.priority || 5);
      scored.push({ name: toolName, ...toolDef, score, tagScore });
    }

    // Step 2: Deduplicate within overlap groups (keep highest score)
    const deduped = [];
    const groupSeen = new Map(); // groupName → { count, top: [...] }

    // First pass: collect group members
    for (const item of scored) {
      if (item.overlap_group) {
        if (!groupSeen.has(item.overlap_group)) {
          groupSeen.set(item.overlap_group, []);
        }
        groupSeen.get(item.overlap_group).push(item);
      }
    }

    // Second pass: keep top-K per group
    const groupKept = new Set();
    for (const [groupName, members] of groupSeen) {
      const rule = overlapRules[groupName] || { keep: 1 };
      members.sort((a, b) => b.score - a.score);
      for (let i = 0; i < Math.min(rule.keep, members.length); i++) {
        deduped.push(members[i]);
        groupKept.add(members[i].name);
      }
    }

    // Add non-group tools
    for (const item of scored) {
      if (!item.overlap_group) {
        deduped.push(item);
      }
    }

    // Final sort by score descending
    deduped.sort((a, b) => b.score - a.score);

    // Log dedup info for debugging
    for (const [groupName] of groupSeen) {
      const kept = deduped.filter(d => d.overlap_group === groupName);
      if (kept.length > 0) {
        console.log(`[SkillRouter] ${groupName}: kept ${kept.length} of ${groupSeen.get(groupName).length} → ${kept.map(t => t.name).join(', ')}`);
      }
    }

    return deduped;
  }

  // ==============================================================
  // UTILITY
  // ==============================================================

  getStats() {
    return window._routerStats?.lastSelection || null;
  }
}

// ─── Global instance ───────────────────────────────────────────
window.skillRouter = new SkillRouter();
