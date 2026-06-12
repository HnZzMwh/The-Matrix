// ============================================================
// API CONFIG & LLM/VLM/IMAGE CALLS
// ============================================================

const CFG_KEY = 'matrix_api_config';
const PROFILE_KEY = 'matrix_api_profiles';
const TOKEN_KEY = 'matrix_token_usage';

// Pricing: $ per 1M tokens (input, output)
const MODEL_PRICES = {
  'claude-sonnet-4-20250514':       [5,   25  ],
  'claude-sonnet-4-20250514-4':     [5,   25  ],
  'gpt-4o':                         [2.5, 10  ],
  'gpt-4o-mini':                    [0.15,0.6 ],
  'gemini-2.0-flash':               [0.15,0.6 ],
  'gemini-2.5-pro':                 [1.25,10  ],
  'deepseek-chat':                  [0.27,1.1 ],
  'deepseek-reasoner':              [0.55,2.19],
  'qwen2.5:7b-instruct':            [0,   0   ], // local
  'qwen2.5-coder:7b-instruct':      [0,   0   ],
};

function getModelPrice(model) {
  if (!model) return [0, 0];
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  for (const [key, price] of Object.entries(MODEL_PRICES)) {
    if (model.startsWith(key)) return price;
  }
  return [0, 0];
}

function getTokenUsage() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return freshUsage();
    const u = JSON.parse(raw);
    if (!u.daily) u.daily = {};
    if (!u.byAgent) u.byAgent = {};
    if (!u.byModel) u.byModel = {};
    if (!Array.isArray(u.events)) u.events = [];
    return u;
  } catch { return freshUsage(); }
}
function freshUsage() {
  return { daily: {}, byModel: {}, byAgent: {}, events: [], totalCalls: 0, totalInput: 0, totalOutput: 0, totalCost: 0, sessionStart: Date.now() };
}

function saveTokenUsage(u) {
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify(u)); } catch {}
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function trackTokenUsage(provider, model, inputTokens, outputTokens, agentId) {
  const u = getTokenUsage();
  const [priceIn, priceOut] = getModelPrice(model);
  const costIn  = inputTokens  / 1e6 * priceIn;
  const costOut = outputTokens / 1e6 * priceOut;
  const cost = costIn + costOut;
  const day = todayKey();
  const agent = agentId || '_unassigned';

  // Totals
  u.totalCalls++;
  u.totalInput  += inputTokens;
  u.totalOutput += outputTokens;
  u.totalCost   += cost;

  // Daily bucket
  if (!u.daily[day]) u.daily[day] = { input: 0, output: 0, cost: 0, calls: 0 };
  const d = u.daily[day];
  d.input += inputTokens; d.output += outputTokens; d.cost += cost; d.calls++;

  // Per-model
  const key = `${provider}:${model}`;
  if (!u.byModel[key]) u.byModel[key] = { calls: 0, input: 0, output: 0, cost: 0, provider, model };
  const m = u.byModel[key];
  m.calls++; m.input += inputTokens; m.output += outputTokens; m.cost += cost;

  // Per-agent
  if (!u.byAgent[agent]) u.byAgent[agent] = { calls: 0, input: 0, output: 0, cost: 0, byModel: {} };
  const a = u.byAgent[agent];
  a.calls++; a.input += inputTokens; a.output += outputTokens; a.cost += cost;
  if (!a.byModel[key]) a.byModel[key] = { calls: 0, input: 0, output: 0, cost: 0, provider, model };
  const am = a.byModel[key];
  am.calls++; am.input += inputTokens; am.output += outputTokens; am.cost += cost;

  // Keep timestamped calls so the usage chart can show hour/day/month ranges.
  const now = Date.now();
  u.events.push({ ts: now, provider, model, agent, input: inputTokens, output: outputTokens, cost });
  const keepAfter = now - 35 * 24 * 60 * 60 * 1000;
  u.events = u.events.filter(e => e && e.ts >= keepAfter);

  saveTokenUsage(u);
  return u;
}

function getLast7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// ─── Profile system (multi-config) ──────────────────────────
const CUSTOM_PRESETS = [
  { label: 'DeepSeek',       url: 'https://api.deepseek.com' },
  { label: 'Groq',           url: 'https://api.groq.com/openai/v1' },
  { label: 'OpenRouter',     url: 'https://openrouter.ai/api/v1' },
  { label: 'Together AI',    url: 'https://api.together.xyz/v1' },
  { label: '阿里云百炼',      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { label: 'SiliconFlow',    url: 'https://api.siliconflow.cn/v1' },
  { label: 'Moonshot',       url: 'https://api.moonshot.cn/v1' },
  { label: '零一万物',        url: 'https://api.lingyiwanwu.com/v1' },
  { label: 'Custom',          url: '' },
];

function defaultProfile(name) {
  return { name, llmProvider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'qwen2.5:7b-instruct', claudeKey: '', openaiKey: '', openaiModel: 'gpt-4o', geminiKey: '', llmCustomUrl: '', llmCustomKey: '', llmCustomModel: '', llmMaxConcurrency: 1, githubToken: '' };
}

function getProfiles() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  // Migrate: create first profile from existing cfg
  const p = defaultProfile('Default');
  if (cfg.llmProvider) p.llmProvider = cfg.llmProvider;
  if (cfg.claudeKey) p.claudeKey = cfg.claudeKey;
  if (cfg.openaiKey) p.openaiKey = cfg.openaiKey;
  if (cfg.openaiModel) p.openaiModel = cfg.openaiModel;
  if (cfg.geminiKey) p.geminiKey = cfg.geminiKey;
  if (cfg.llmCustomUrl) p.llmCustomUrl = cfg.llmCustomUrl;
  if (cfg.llmCustomKey) p.llmCustomKey = cfg.llmCustomKey;
  if (cfg.llmCustomModel) p.llmCustomModel = cfg.llmCustomModel;
  if (cfg.ollamaUrl) p.ollamaUrl = cfg.ollamaUrl;
  if (cfg.ollamaModel) p.ollamaModel = cfg.ollamaModel;
  if (cfg.llmMaxConcurrency) p.llmMaxConcurrency = cfg.llmMaxConcurrency;
  const profiles = { list: [p], active: 'Default' };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles));
  return profiles;
}

function saveProfiles(profiles) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles));
}

function getActiveProfileName() {
  const p = getProfiles();
  return p.active || (p.list[0] && p.list[0].name) || 'Default';
}

function getProfile(name) {
  const p = getProfiles();
  return p.list.find(x => x.name === name);
}

function deleteProfile(name) {
  const p = getProfiles();
  p.list = p.list.filter(x => x.name !== name);
  if (p.active === name) p.active = p.list[0] ? p.list[0].name : '';
  saveProfiles(p);
}

function saveProfile(name, data) {
  const p = getProfiles();
  const idx = p.list.findIndex(x => x.name === name);
  if (idx >= 0) p.list[idx] = { ...p.list[idx], ...data, name };
  else p.list.push({ ...defaultProfile(name), ...data, name });
  saveProfiles(p);
}

function activateProfile(name) {
  const p = getProfiles();
  const profile = p.list.find(x => x.name === name);
  if (!profile) return;
  p.active = name;
  saveProfiles(p);
  // Load into global cfg
  cfg.llmProvider  = profile.llmProvider || 'ollama';
  cfg.claudeKey    = profile.claudeKey    || '';
  cfg.openaiKey    = profile.openaiKey    || '';
  cfg.openaiModel  = profile.openaiModel  || 'gpt-4o';
  cfg.geminiKey    = profile.geminiKey    || '';
  cfg.llmCustomUrl   = profile.llmCustomUrl   || '';
  cfg.llmCustomKey   = profile.llmCustomKey   || '';
  cfg.llmCustomModel = profile.llmCustomModel || '';
  cfg.ollamaUrl    = profile.ollamaUrl    || 'http://localhost:11434';
  cfg.ollamaModel  = profile.ollamaModel  || 'qwen2.5:7b-instruct';
  cfg.llmMaxConcurrency = parseInt(profile.llmMaxConcurrency) || 1;
  cfg.githubToken = profile.githubToken || '';
  saveCfg();
}

function profileToFields(name) {
  const profile = getProfile(name);
  if (!profile) return {};
  return {
    llmProvider: profile.llmProvider || 'ollama',
    claudeKey: profile.claudeKey || '',
    openaiKey: profile.openaiKey || '',
    openaiModel: profile.openaiModel || 'gpt-4o',
    geminiKey: profile.geminiKey || '',
    llmCustomUrl: profile.llmCustomUrl || '',
    llmCustomKey: profile.llmCustomKey || '',
    llmCustomModel: profile.llmCustomModel || '',
    ollamaUrl: profile.ollamaUrl || 'http://localhost:11434',
    ollamaModel: profile.ollamaModel || 'qwen2.5:7b-instruct',
    llmMaxConcurrency: parseInt(profile.llmMaxConcurrency) || 1,
    githubToken: profile.githubToken || '',
  };
}

function fieldsToProfile(fields) {
  return {
    llmProvider: fields.llmProvider || 'ollama',
    claudeKey: fields.claudeKey || '',
    openaiKey: fields.openaiKey || '',
    openaiModel: fields.openaiModel || 'gpt-4o',
    geminiKey: fields.geminiKey || '',
    llmCustomUrl: fields.llmCustomUrl || '',
    llmCustomKey: fields.llmCustomKey || '',
    llmCustomModel: fields.llmCustomModel || '',
    ollamaUrl: fields.ollamaUrl || 'http://localhost:11434',
    ollamaModel: fields.ollamaModel || 'qwen2.5:7b-instruct',
    llmMaxConcurrency: parseInt(fields.llmMaxConcurrency) || 1,
    githubToken: fields.githubToken || '',
  };
}

// ─── Backward-compatible cfg object ─────────────────────────
// Always derived from active profile + localStorage fallback
const cfg = (() => {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
})();
cfg.llmProvider  = cfg.llmProvider  || 'ollama';
cfg.claudeKey    = cfg.claudeKey    || '';
cfg.openaiKey    = cfg.openaiKey    || '';
cfg.openaiModel  = cfg.openaiModel  || 'gpt-4o';
cfg.ollamaUrl    = cfg.ollamaUrl    || 'http://localhost:11434';
cfg.ollamaModel  = cfg.ollamaModel  || 'qwen2.5:7b-instruct';
cfg.geminiKey      = cfg.geminiKey      || '';
cfg.llmCustomUrl   = cfg.llmCustomUrl   || '';
cfg.llmCustomKey   = cfg.llmCustomKey   || '';
cfg.llmCustomModel = cfg.llmCustomModel || '';
cfg.llmMaxConcurrency = parseInt(cfg.llmMaxConcurrency) || 1;

// Ensure cfg is in sync with active profile on first load
(function syncCfg() {
  const p = getProfiles();
  if (p.active && p.list.length > 0) {
    activateProfile(p.active);
  } else {
    saveCfg();
  }
})();

function saveCfg() { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }

// ─── Fetch with timeout ─────────────────────────────────────
async function fetchWithTimeout(url, options, timeoutMs = 15000, externalSignal) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  // Link external signal
  if (externalSignal) {
    externalSignal.addEventListener('abort', () => ac.abort(), { once: true });
  }
  try {
    const resp = await fetch(url, { ...options, signal: ac.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// UNIFIED LLM CALL
// ============================================================

// ─── LLM request queue (configurable concurrency) ──
let _llmRunning = 0;
const _llmQueue = [];

function _llmMaxConcurrency() {
  return parseInt(cfg.llmMaxConcurrency) || 1;
}

function _llmDispatch() {
  while (_llmRunning < _llmMaxConcurrency() && _llmQueue.length > 0) {
    _llmRunning++;
    const { fn, resolve, reject } = _llmQueue.shift();
    fn().then(resolve, reject).finally(() => {
      _llmRunning--;
      _llmDispatch();
    });
  }
}

function _llmQueueCall(fn) {
  return new Promise((resolve, reject) => {
    _llmQueue.push({ fn, resolve, reject });
    _llmDispatch();
  });
}

async function callLLM(messages, systemPrompt, agentId, abortSignal) {
  return _llmQueueCall(async () => {
  systemPrompt += '\n\n## Language Rules\n- Descriptive text, result reports, and conversation replies: use English\n- Code, parameter names, and professional terminology (e.g. API, HTTP, JSON, variable names): keep as-is\n- Match the user\'s language: if the user writes in Chinese, reply in Chinese; if the user writes in English, reply in English\n- For long replies, put the core conclusion first. Place detailed expansion after the `---` separator line (content after the separator is automatically collapsed)';

  // Per-agent LLM override
  const agent = (typeof agents !== 'undefined') ? agents.find(a => a.id === agentId) : null;
  const overrideProvider = agent?.llmProvider || '';
  const overrideModel = agent?.llmModel || '';
  const overrideKey = agent?.llmKey || '';
  const p = overrideProvider || cfg.llmProvider;

  for (let retry = 0; retry < 3; retry++) {
    // Check abort before each retry
    if (abortSignal && abortSignal.aborted) return '// [STEERED] Task redirected by user. //';
    try {
      if (p === 'claude') {
        const key = overrideKey || cfg.claudeKey;
        if (!key) return '// Please configure Claude Key in API settings';
        const model = overrideModel || 'claude-sonnet-4-20250514';
        const systemContent = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
        const cachedMessages = messages.map((m, i) => {
          if (i === messages.length - 1 && messages.length > 0) {
            if (Array.isArray(m.content)) {
              const lastWithCache = m.content.map((part, j) => {
                if (j === m.content.length - 1 && part.type === 'text') {
                  return { ...part, cache_control: { type: 'ephemeral' } };
                }
                return part;
              });
              return { ...m, content: lastWithCache };
            }
            return { ...m, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] };
          }
          return m;
        });
        const resp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
            'anthropic-beta': 'prompt-caching-2024-07-31' },
          body: JSON.stringify({ model, max_tokens: 1000, system: systemContent, messages: cachedMessages })
        }, 30000, abortSignal);
        const d = await resp.json();
        if (d.error) throw new Error(d.error.message);
        const claudeText = d.content.map(c => c.text || '').join('');
        if (d.usage) trackTokenUsage('claude', model, d.usage.input_tokens || 0, d.usage.output_tokens || 0, agentId);
        return claudeText;
      }
      if (p === 'openai') {
        const key = overrideKey || cfg.openaiKey;
        if (!key) return '// Please configure OpenAI Key in API settings';
        const model = overrideModel || cfg.openaiModel || 'gpt-4o';
        const openaiMessages = [{ role: 'system', content: systemPrompt }, ...messages.map(m => {
          if (Array.isArray(m.content)) {
            return { role: m.role, content: m.content.map(part => {
              if (part.type === 'image' && part.source) {
                return { type: 'image_url', image_url: { url: `data:${part.source.media_type || 'image/png'};base64,${part.source.data}` } };
              }
              return part;
            })};
          }
          return m;
        })];
        const resp = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({ model, messages: openaiMessages })
        }, 30000, abortSignal);
        const d = await resp.json();
        if (d.error) throw new Error(d.error.message);
        if (d.usage) trackTokenUsage('openai', model, d.usage.prompt_tokens || 0, d.usage.completion_tokens || 0, agentId);
        return d.choices[0].message.content;
      }
      if (p === 'gemini') {
        const key = overrideKey || cfg.geminiKey;
        if (!key) return '// Please configure Gemini Key';
        const model = overrideModel || 'gemini-2.0-flash';
        const contents = [];
        for (const m of messages) {
          if (Array.isArray(m.content)) {
            const parts = m.content.map(part => {
              if (part.type === 'image' && part.source) {
                return { inlineData: { mimeType: part.source.media_type || 'image/png', data: part.source.data } };
              }
              if (part.type === 'text') return { text: part.text };
              return { text: String(part) };
            });
            contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
          } else {
            contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
          }
        }
        const body = { contents };
        if (systemPrompt) body.system_instruction = { parts: [{ text: systemPrompt }] };
        const resp = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }, 30000, abortSignal);
        const d = await resp.json();
        if (d.error) throw new Error(d.error.message);
        if (d.usageMetadata) trackTokenUsage('gemini', model, d.usageMetadata.promptTokenCount || 0, d.usageMetadata.candidatesTokenCount || 0, agentId);
        return d.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '(no response)';
      }
      if (p === 'custom') {
        const key = overrideKey || cfg.llmCustomKey;
        const model = overrideModel || cfg.llmCustomModel;
        const url = cfg.llmCustomUrl;
        if (!url || !key || !model) return '// Please fill Custom provider fields';
        const customMessages = [{ role: 'system', content: systemPrompt }, ...messages.map(m => {
          if (Array.isArray(m.content)) {
            return { role: m.role, content: m.content.filter(c => c.type === 'text').map(c => c.text).join('\n') };
          }
          return m;
        })];
        const resp = await fetchWithTimeout(`${url.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({ model, messages: customMessages })
        }, 120000, abortSignal);
        const d = await resp.json();
        if (d.error) throw new Error(typeof d.error === 'string' ? d.error : (d.error.message || JSON.stringify(d.error)));
        if (d.usage) trackTokenUsage('custom', model, d.usage.prompt_tokens || 0, d.usage.completion_tokens || 0, agentId);
        return d.choices[0].message.content;
      }
      if (p === 'ollama') {
        const base = cfg.ollamaUrl || 'http://localhost:11434';
        const model = overrideModel || cfg.ollamaModel || 'llama3';
        const ollamaMessages = [{ role: 'system', content: systemPrompt }, ...messages.map(m => {
          if (Array.isArray(m.content)) {
            return { role: m.role, content: m.content.filter(c => c.type === 'text').map(c => c.text).join('\n') };
          }
          return m;
        })];
        const body = JSON.stringify({ model, stream: false, messages: ollamaMessages });
        const resp = await fetchWithTimeout(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body
        }, 300000, abortSignal);
        const d = await resp.json();
        if (d.error) throw new Error(typeof d.error === 'string' ? d.error : JSON.stringify(d.error));
        if (!d.message || !d.message.content) throw new Error('Ollama returned empty response. Check if model is running: ollama ps');
        if (typeof d.prompt_eval_count === 'number' || typeof d.eval_count === 'number')
          trackTokenUsage('ollama', model, d.prompt_eval_count || 0, d.eval_count || 0, agentId);
        return d.message.content;
      }
      return '// Unknown provider';
    } catch (e) {
      // If aborted by steering, don't retry
      if (abortSignal && abortSignal.aborted) return '// [STEERED] Task redirected by user. //';
      const isRateLimit = e.message && (
        e.message.includes('429') ||
        e.message.includes('rate limit') ||
        e.message.includes('Too Many Requests') ||
        e.message.includes('速率限制')
      );
      if (!isRateLimit || retry === 2) {
        console.error('callLLM error:', e);
        return '// LLM ERROR // ' + (e.message || e) + ' // Check [API] config or server status.';
      }
      const delay = Math.pow(2, retry) * 1000 + Math.random() * 1000;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  });
}

// ============================================================
// UNIFIED VLM CALL (image analysis)
// ============================================================
async function callVLM(base64jpeg, prompt) {
  const p = cfg.vlmProvider;
  try {
    if (p === 'claude') {
      if (!cfg.claudeKey) return null;
      const resp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.claudeKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 400,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64jpeg } },
            { type: 'text', text: prompt }
          ]}]
        })
      }, 30000);
      const d = await resp.json();
      if (d.error) throw new Error(d.error.message);
      return d.content.map(c => c.text || '').join('');
    }
    if (p === 'openai') {
      if (!cfg.openaiKey) return null;
      const resp = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o', max_tokens: 400,
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64jpeg}`, detail: 'low' } },
            { type: 'text', text: prompt }
          ]}]
        })
      }, 30000);
      const d = await resp.json();
      if (d.error) throw new Error(d.error.message);
      return d.choices[0].message.content;
    }
    if (p === 'gemini') {
      const gKey = cfg.geminiVlmKey || cfg.geminiKey;
      if (!gKey) return null;
      const resp = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${gKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64jpeg } },
          { text: prompt }
        ]}]})
      }, 30000);
      const d = await resp.json();
      if (d.error) throw new Error(d.error.message);
      return d.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '(no response)';
    }
    if (p === 'custom') {
      if (!cfg.vlmCustomUrl || !cfg.vlmCustomKey || !cfg.vlmCustomModel) return null;
      const resp = await fetchWithTimeout(`${cfg.vlmCustomUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.vlmCustomKey}` },
        body: JSON.stringify({
          model: cfg.vlmCustomModel, max_tokens: 400,
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64jpeg}`, detail: 'low' } },
            { type: 'text', text: prompt }
          ]}]
        })
      }, 30000);
      const d = await resp.json();
      if (d.error) throw new Error(d.error.message);
      return d.choices[0].message.content;
    }
    if (p === 'ollama') {
      const base = cfg.ollamaUrl || 'http://localhost:11434';
      const model = cfg.ollamaVlm || 'llava';
      const resp = await fetchWithTimeout(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: `data:image/jpeg;base64,${base64jpeg}` },
          { type: 'text', text: prompt }
        ]}]})
      }, 15000);
      const d = await resp.json();
      if (d.error) throw new Error(typeof d.error === 'string' ? d.error : JSON.stringify(d.error));
      return d.message?.content || '';
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ============================================================
// IMAGE GENERATION (DALL-E / compatible)
// ============================================================
async function callImageGen(prompt) {
  const p = cfg.llmProvider;
  let baseUrl, apiKey, model;
  if (p === 'openai') {
    baseUrl = 'https://api.openai.com/v1';
    apiKey = cfg.openaiKey;
    model = 'dall-e-3';
  } else if (p === 'gemini') {
    if (!cfg.geminiKey) return null;
    const resp = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${cfg.geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['Text', 'Image'] }
      })
    }, 30000);
    const d = await resp.json();
    if (d.error) throw new Error(d.error.message);
    const parts = d.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(p => p.inlineData);
    if (imgPart) {
      return `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`;
    }
    return null;
  } else if (p === 'custom') {
    let u = cfg.llmCustomUrl.replace(/\/chat\/completions$/, '').replace(/\/+$/, '');
    baseUrl = u;
    apiKey = cfg.llmCustomKey;
    model = cfg.llmCustomModel || 'dall-e-3';
  } else {
    return null;
  }
  if (!apiKey) return null;
  const resp = await fetchWithTimeout(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024' })
  }, 30000);
  const d = await resp.json();
  if (d.error) throw new Error(d.error.message);
  return d.data[0].url;
}

// ============================================================
