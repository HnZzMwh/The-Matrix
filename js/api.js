// ============================================================
// API CONFIG & LLM/VLM/IMAGE CALLS
// ============================================================

const CFG_KEY = 'matrix_api_config';

const cfg = (() => {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
})();
cfg.llmProvider  = cfg.llmProvider  || 'ollama';
cfg.vlmProvider  = cfg.vlmProvider  || 'gemini';
cfg.claudeKey    = cfg.claudeKey    || '';
cfg.openaiKey    = cfg.openaiKey    || '';
cfg.openaiModel  = cfg.openaiModel  || 'gpt-4o';
cfg.ollamaUrl    = cfg.ollamaUrl    || 'http://localhost:11434';
cfg.ollamaModel  = cfg.ollamaModel  || 'qwen2.5:7b-instruct';
cfg.ollamaVlm    = cfg.ollamaVlm    || 'llava';
cfg.geminiKey      = cfg.geminiKey      || '';
cfg.geminiVlmKey   = cfg.geminiVlmKey   || '';
cfg.llmCustomUrl   = cfg.llmCustomUrl   || '';
cfg.llmCustomKey   = cfg.llmCustomKey   || '';
cfg.llmCustomModel = cfg.llmCustomModel || '';
cfg.vlmCustomUrl   = cfg.vlmCustomUrl   || '';
cfg.vlmCustomKey   = cfg.vlmCustomKey   || '';
cfg.vlmCustomModel = cfg.vlmCustomModel || '';
cfg.googleSearchKey = cfg.googleSearchKey || '';
cfg.googleSearchCx  = cfg.googleSearchCx  || '';

function saveCfg() { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }

// ─── Fetch with timeout ─────────────────────────────────────
async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
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
async function callLLM(messages, systemPrompt) {
  const p = cfg.llmProvider;
  try {
    if (p === 'claude') {
      if (!cfg.claudeKey) return '// Please configure Claude Key in API settings';
      const resp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.claudeKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system: systemPrompt, messages })
      }, 30000);
      const d = await resp.json();
      if (d.error) throw new Error(d.error.message);
      return d.content.map(c => c.text || '').join('');
    }
    if (p === 'openai') {
      if (!cfg.openaiKey) return '// Please configure OpenAI Key in API settings';
      const model = cfg.openaiModel || 'gpt-4o';
      const resp = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.openaiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...messages] })
      }, 30000);
      const d = await resp.json();
      if (d.error) throw new Error(d.error.message);
      return d.choices[0].message.content;
    }
    if (p === 'gemini') {
      if (!cfg.geminiKey) return '// Please configure Gemini Key';
      const contents = [];
      for (const m of messages) {
        contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
      }
      const body = { contents };
      if (systemPrompt) body.system_instruction = { parts: [{ text: systemPrompt }] };
      const resp = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${cfg.geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, 30000);
      const d = await resp.json();
      if (d.error) throw new Error(d.error.message);
      return d.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '(no response)';
    }
    if (p === 'custom') {
      if (!cfg.llmCustomUrl || !cfg.llmCustomKey || !cfg.llmCustomModel) return '// Please fill Custom provider fields';
      const resp = await fetchWithTimeout(`${cfg.llmCustomUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.llmCustomKey}` },
        body: JSON.stringify({ model: cfg.llmCustomModel, messages: [{ role: 'system', content: systemPrompt }, ...messages] })
      }, 30000);
      const d = await resp.json();
      if (d.error) throw new Error(d.error.message || d.error);
      return d.choices[0].message.content;
    }
    if (p === 'ollama') {
      const base = cfg.ollamaUrl || 'http://localhost:11434';
      const model = cfg.ollamaModel || 'llama3';
      const resp = await fetchWithTimeout(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, messages: [{ role: 'system', content: systemPrompt }, ...messages] })
      }, 15000);
      const d = await resp.json();
      if (d.error) throw new Error(typeof d.error === 'string' ? d.error : JSON.stringify(d.error));
      if (!d.message || !d.message.content) throw new Error('Ollama returned empty response. Check if model is running: ollama ps');
      return d.message.content;
    }
    return '// Unknown provider';
  } catch (e) {
    return '...System disturbance. Signal unstable. Please retry, Host.';
  }
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
// WEB SEARCH & FETCH
// ============================================================
async function webSearch(query, count) {
  if (!cfg.googleSearchKey || !cfg.googleSearchCx) {
    return '// Please configure Google Search API Key and Search Engine ID in API settings';
  }
  const num = Math.min(Math.max(1, count || 5), 10);
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(cfg.googleSearchKey)}&cx=${encodeURIComponent(cfg.googleSearchCx)}&q=${encodeURIComponent(query)}&num=${num}`;
    const resp = await fetchWithTimeout(url, {}, 10000);
    const data = await resp.json();
    if (data.error) return `// Google Search API error: ${data.error.message}`;
    if (!data.items || data.items.length === 0) return `// No results found for "${query}"`;
    const lines = data.items.map((item, i) => {
      const title = item.title || '(no title)';
      const link = item.link || '';
      const snippet = (item.snippet || '').replace(/\n/g, ' ').slice(0, 200);
      return `${i + 1}. ${title}\n   URL: ${link}\n   ${snippet}`;
    });
    return lines.join('\n\n');
  } catch (e) {
    return `// Search failed: ${e.message || 'network error'}`;
  }
}

async function webFetch(url) {
  if (!url) return '// Please provide a URL: url="https://example.com"';
  try {
    const resp = await fetchWithTimeout(url, {}, 15000);
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const text = JSON.stringify(await resp.json(), null, 2);
      return text.slice(0, 8000);
    }
    const text = await resp.text();
    const cleaned = text
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[#a-zA-Z0-9]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.slice(0, 8000) || '(empty page)';
  } catch (e) {
    return `// Fetch failed: ${e.message || 'network error'}`;
  }
}
