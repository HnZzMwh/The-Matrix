// ============================================================
// CHAT — Concurrent per-agent messaging + typewriter effect
// ============================================================

// ─── Per-agent runtime state ─────────────────────────────────
const agentStates = {};
const MAX_COLLAB_DEPTH = 2;
const MAX_HISTORY = 40;

// ─── Code Mode ──────────────────────────────────────────────────
const CODE_MODE_TRIGGERS = /(?:今日任务|开发模式|写代码|code mode)/i;

function triggersCodeMode(text) {
  return CODE_MODE_TRIGGERS.test(text);
}

function getCurrentMode() {
  const session = (typeof getCurrentSession === 'function') ? getCurrentSession() : null;
  return session ? (session.mode || 'chat') : 'chat';
}

function setSessionMode(mode) {
  if (mode !== 'chat' && mode !== 'code') return;
  const session = (typeof getCurrentSession === 'function') ? getCurrentSession() : null;
  if (!session) return;
  session.mode = mode;
  if (typeof persistCurrentSession === 'function') persistCurrentSession();
  if (typeof renderSessionsRight === 'function') renderSessionsRight();
  // Update panel title
  const panelTitle = document.getElementById('sessions-panel-title');
  if (panelTitle) panelTitle.textContent = mode === 'code' ? 'SESSIONS' : 'CHAT HISTORY';
  // Update mode toggle button
  const modeBtn = document.getElementById('mode-toggle-btn');
  if (modeBtn) modeBtn.textContent = '[' + (mode === 'code' ? 'CODE' : 'CHAT') + ']';
}

function toggleSessionMode() {
  const session = (typeof getCurrentSession === 'function') ? getCurrentSession() : null;
  if (!session) return;
  setSessionMode(session.mode === 'chat' ? 'code' : 'chat');
}

function truncateHistory(messages) {
  if (messages.length <= MAX_HISTORY) return messages;
  const system = messages.filter(m => m.role === 'system');
  const recent = messages.filter(m => m.role !== 'system').slice(-MAX_HISTORY);
  return [...system, ...recent];
}

// Detects if LLM text talks about writing/saving files without using tool syntax
const WRITE_INTENT_RE = /(?:i['"]?ll\s+(?:save|write|create|output|put)|(?:saving|writing|creating)\s+|\bwritten\b|\bsaved\b|写[入完]?|保存|创建|生成|新建|文件)/i;
const FILE_PATH_RE = /[a-zA-Z]:\\(?:[^\\\s]+\\)*[^\\\s]*\.[a-zA-Z0-9]+/;
function hasWriteIntent(text) {
  return WRITE_INTENT_RE.test(text) && FILE_PATH_RE.test(text);
}

// LangGraph engine availability (disabled — use local Ollama directly)
const LANGGRAPH_AVAILABLE = false;
let lgEngineReady = false;
let lgCheckTime = 0;

async function checkLangGraph() {
  if (!LANGGRAPH_AVAILABLE) return false;
  if (lgEngineReady && Date.now() - lgCheckTime < 30000) return true;
  try {
    const status = await window.electronAPI.lg.getStatus();
    lgEngineReady = status.ready;
    lgCheckTime = Date.now();
    return lgEngineReady;
  } catch { lgEngineReady = false; return false; }
}

async function callLangGraph(agentId, message, history) {
  try {
    const result = await window.electronAPI.lg.run({
      agent_id: agentId,
      message,
      history: history.map(m => ({ role: m.role, content: m.text || m.content || '' })),
      sender_name: 'User',
    });
    return result;
  } catch (e) {
    return { text: '', error: e.message, mentions: [] };
  }
}

// Try to init LangGraph check on load
if (LANGGRAPH_AVAILABLE) {
  checkLangGraph();
}

function setAgentStatus(agentId, text) {
  const st = ensureState(agentId);
  st.status = text;
  renderAgents();
}

function addFileOpMsg(agentId, toolName, path, toolResult) {
  const st = ensureState(agentId);
  const label = toolName === 'write_file' ? '// [CREATE]' : '// [PATCH]';
  const shortPath = path.replace(/\\/g, '/').split('/').slice(-2).join('/');
  let detail = '';
  if (toolName === 'patch_file' && toolResult) {
    const m = toolResult.match(/(\d+)→(\d+) lines/);
    if (m) {
      const oldL = +m[1], newL = +m[2];
      const diff = newL - oldL;
      detail = diff >= 0 ? ` +${diff}` : ` ${diff}`;
    }
  }
  const text = `${label} ${shortPath}${detail}`;
  st.messages.push({ role: 'system', text, time: Date.now() });
}

function ensureState(agentId) {
  if (!agentStates[agentId]) {
    agentStates[agentId] = {
      messages: [],
      isThinking: false,
      typing: null,
      status: '',
      lastTime: 0,
      abort: null,
      _systemPromptEmbedded: false,
    };
  }
  return agentStates[agentId];
}

// ─── Abort controller per agent (for Steering) ─────────────
function newAgentAbort(agentId) {
  const st = ensureState(agentId);
  if (st.abort) st.abort.abort();
  st.abort = new AbortController();
  return st.abort.signal;
}

function abortAgent(agentId) {
  const st = agentStates[agentId];
  if (st && st.abort) {
    st.abort.abort();
    st.abort = null;
  }
}

// ─── Task DAG Engine ─────────────────────────────────────────
// Manages task dependency graph for parallel agent execution.
class TaskDAG {
  constructor() {
    this.tasks = {};          // id -> { id, agentId, instruction, deps, status, result }
    this.fileRegistry = {};   // file -> [taskId]
    this._resolve = null;     // promise resolve for completion
  }

  addTask(id, agentId, instruction, deps = []) {
    this.tasks[id] = { id, agentId, instruction, deps, status: 'pending', result: '' };
    return this;
  }

  getReadyTasks() {
    return Object.values(this.tasks).filter(t =>
      t.status === 'pending' &&
      t.deps.every(d => this.tasks[d] && this.tasks[d].status === 'done')
    );
  }

  isComplete() {
    return Object.values(this.tasks).every(t => t.status === 'done' || t.status === 'failed');
  }

  recordFileWrite(file, taskId) {
    if (!this.fileRegistry[file]) this.fileRegistry[file] = [];
    if (!this.fileRegistry[file].includes(taskId)) this.fileRegistry[file].push(taskId);
  }

  getAffectedTasks(file) {
    return this.fileRegistry[file] || [];
  }
}

let currentDAG = null;

// ─── Task plan parsing ────────────────────────────────────────
// Expects format in MORPHEUS response:
//   TASK_PLAN
//   A: @ORACLE :: instruction :: deps: none
//   B: @NEO :: instruction :: deps: [A]
//   C: @SMITH :: audit :: deps: [B]
function parseTaskPlan(text) {
  const lines = text.split('\n');
  const planStart = lines.findIndex(l => l.trim().startsWith('TASK_PLAN'));
  if (planStart < 0) return null;

  const dag = new TaskDAG();
  for (let i = planStart + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('TASK_PLAN')) continue;
    const m = line.match(/^(\w+)\s*:\s*@(\w+)\s*::\s*(.+?)\s*::\s*deps:\s*\[?([^\]]*)\]?\s*$/i);
    if (!m) continue;
    const [, id, agentName, instruction, depsRaw] = m;
    const agent = agents.find(a => a.name.toUpperCase() === agentName.toUpperCase());
    if (!agent) continue;
    const deps = depsRaw.trim().toLowerCase() === 'none' ? [] :
      depsRaw.split(',').map(d => d.trim()).filter(Boolean);
    dag.addTask(id.toUpperCase(), agent.id, instruction.trim(), deps.map(d => d.toUpperCase()));
  }
  return Object.keys(dag.tasks).length > 0 ? dag : null;
}

// ─── Execute DAG: run ready tasks in parallel ─────────────────
async function executeTaskDag(dag, sourceText) {
  currentDAG = dag;
  showToast('// EXECUTING TASK DAG //');

  while (!dag.isComplete()) {
    const ready = dag.getReadyTasks();
    if (ready.length === 0 && !dag.isComplete()) {
      // Check for stalled tasks
      const stalled = Object.values(dag.tasks).filter(t => t.status === 'running');
      if (stalled.length === 0) break; // deadlock
      // Wait for running tasks
      await new Promise(r => setTimeout(r, 500));
      continue;
    }
    // Launch all ready tasks in parallel
    const promises = ready.map(task => {
      task.status = 'running';
      return executeTaskNode(task, dag);
    });
    await Promise.all(promises);
  }

  showToast('// TASK DAG COMPLETE //');
  currentDAG = null;
}

// ─── Execute a single DAG node ────────────────────────────────
async function executeTaskNode(task, dag) {
  const targetAg = agents.find(a => a.id === task.agentId);
  if (!targetAg) { task.status = 'failed'; return; }

  // Build precise context: only deps results, not full history
  let context = `[TASK: ${task.id}] ${task.instruction}`;
  if (task.deps.length > 0) {
    const depResults = task.deps.map(dId => {
      const dep = dag.tasks[dId];
      return dep ? `[FROM ${dep.agentId} (${dId})]:\n${dep.result.slice(0, 2000)}` : '';
    }).filter(Boolean).join('\n\n');
    if (depResults) context += '\n\n--- DEPENDENCY RESULTS ---\n' + depResults;
  }

  const routedText = `[DAG TASK ${task.id} → ${targetAg.name}]: ${context}`;
  const st = ensureState(task.agentId);

  // File change impact info: if deps wrote files, warn this task
  const impactedBy = [];
  if (task.deps.length > 0) {
    for (const dId of task.deps) {
      const dep = dag.tasks[dId];
      if (dep) {
        for (const [file, taskIds] of Object.entries(dag.fileRegistry)) {
          if (taskIds.includes(dId)) impactedBy.push(file);
        }
      }
    }
  }
  if (impactedBy.length > 0) {
    context += '\n\n--- FILES CHANGED BY DEPENDENCIES ---\n' + impactedBy.map(f => `  ${f}`).join('\n');
  }

  st.messages.push({ role: 'user', text: routedText, time: Date.now() });
  st.isThinking = true;
  st.typing = null;
  if (currentAgentId === task.agentId) renderAgentChat(task.agentId);
  renderAgents();

  // Build minimal conv history — only system + current task
  const dagSysPrompt = await buildDagSystemPrompt(targetAg, dag);
  const convHistory = [
    { role: 'system',
      content: dagSysPrompt +
         '\n\n## Tool System\nSingle-line: [TOOL: tool_name key="value"]\nMulti-line: [TOOL: tool_name key="value"]\n[/TOOL]\nAvailable: read_file, write_file, code_search, list_dir, read_multiple, run_command, \nIMPORTANT: write_file ONLY accepts "path" and "content". Do NOT add HTML attributes (lang, charset, id, class, etc.). If content has double quotes, wrap it in single quotes.\n\n# ❌ WRONG:\n[TOOL: write_file path="file.html" lang="zh-CN" class="main"]\n# ✅ CORRECT (single-line):\n[TOOL: write_file path="file.html" content=\'<html lang="zh-CN"><body>Hello</body></html>\']\n# ✅ CORRECT (multi-line):\n[TOOL: write_file path="file.html" content=\'<html lang="zh-CN">\\n<body>\\n  <div id="app">Hello</div>\\n</body>\\n</html>\'\n[/TOOL]' },
    { role: 'user', content: routedText },
  ];

  try {
    let reply = await callLLM(convHistory, targetAg.prompt || '', targetAgentId);
    let dagWriteWarned = false;

    // Tool loop (up to 3 iterations)
    for (let tld = 0; tld < 3; tld++) {
      const tcs = extractToolCalls(reply);
      if (tcs.length === 0) {
        if (!dagWriteWarned && hasWriteIntent(reply)) {
          dagWriteWarned = true;
          st.messages.push({ role: 'assistant', text: reply, time: Date.now() });
          const reminder = { role: 'user', content: '你提到了写文件但没有使用 write_file 工具。You MUST use [TOOL: write_file path="..." content="..."] (single-line) or [/TOOL] closing marker (multi-line). IMPORTANT: write_file ONLY accepts "path" and "content". If content has double quotes, use single quotes: content=\'<div class="x">...</div>\'.' };
          st.messages.push({ role: 'user', text: reminder.content, time: Date.now() });
          const nh = st.messages.map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant', content: m.text,
          }));
          reply = await callLLM(nh, targetAg.prompt + '\nTool results provided. Continue.', targetAgentId);
          continue;
        }
        break;
      }
      setAgentStatus(task.agentId, `Running tools [${tcs.map(t => t.name).join(', ')}]...`);
      const results = [];
      for (const tc of tcs) {
        setAgentStatus(task.agentId, `Running ${tc.name}...`);
        const tr = await executeToolCall(tc, task.agentId, targetAg.name);
        results.push(tr);
        if (tc.name === 'write_file') dag.recordFileWrite(tc.args.path || tc.args.file || '', task.id);
        if (tc.name === 'write_file' || tc.name === 'patch_file') {
          addFileOpMsg(task.agentId, tc.name, tc.args.path || tc.args.file || '', typeof tr === 'object' && tr.text ? tr.text : tr);
        }
        setAgentStatus(task.agentId, `${tc.name} done`);
      }
      setAgentStatus(task.agentId, 'Analyzing tool results...');
      st.messages.push({ role: 'assistant', text: reply, time: Date.now() });
      const collImages = [];
      const textResults = results.map(r => {
        if (typeof r === 'object' && r !== null && r.images && r.images.length > 0) {
          collImages.push(...r.images);
          return r.text || '';
        }
        return r;
      });
      const toolOutputJoin = textResults.join('\n\n');
      const failures = textResults.filter(r => typeof r === 'string' && r.includes('<<TOOL') && r.includes('FAILED'));
      const summaryAdd = failures.length > 0 ? `\n## TOOL EXECUTION SUMMARY\n${failures.length} tool(s) FAILED. Do NOT claim success for failed tools.\n` : '';
      const collMsg = { role: 'tool', text: toolOutputJoin + summaryAdd, time: Date.now() };
      if (collImages.length > 0) collMsg.images = collImages;
      st.messages.push(collMsg);
      if (currentAgentId === task.agentId) renderAgentChat(task.agentId);
      const nh = st.messages.map(m => {
        const role = m.role === 'user' ? 'user' : 'assistant';
        if (m.images && m.images.length > 0) {
          const content = [{ type: 'text', text: m.text }];
          for (const img of m.images) {
            content.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType || 'image/png', data: img.data } });
          }
          return { role, content };
        }
        return { role, content: m.text };
      });
      reply = await callLLM(nh, targetAg.prompt + '\nTool results provided. Continue.', targetAgentId);
    }

    task.result = reply;
    task.status = 'done';
    st.messages.push({ role: 'assistant', text: reply, time: Date.now() });
    st.isThinking = false;
    st.status = '';
    if (currentAgentId === task.agentId) renderAgentChat(task.agentId);
    saveChat(task.agentId, st.messages);
    targetAg.lastTime = Date.now(); saveAgents(); renderAgents();
    if (typeof triggerFileBrowserRefresh === 'function') triggerFileBrowserRefresh();

  } catch (e) {
    setAgentStatus(task.agentId, 'Task failed');
    task.status = 'failed';
    task.result = e.message || 'Task failed';
    st.messages.push({ role: 'assistant', text: `[TASK ${task.id} FAILED]: ${task.result}`, time: Date.now() });
    st.isThinking = false;
    st.status = '';
    saveChat(task.agentId, st.messages);
  }
}

async function buildDagSystemPrompt(agent, dag) {
  const allAgentNames = agents.filter(a => a.id !== agent.id).map(a => a.name).join(', ');
  // Build dynamic tool list from pluginManager
  const pm = window.pluginManager;
  const toolList = pm ? Array.from(pm.tools.keys()).join(', ') : '';
  let base = `You are ${agent.name}. You are executing a task in a DAG workflow.
Available agents: ${allAgentNames}.
You may use tools: [TOOL: tool_name key="value"]
Available tools: ${toolList}\nComplete your task and report results concisely.`;
  if (typeof buildMemorySummary !== 'undefined') {
    try { const mem = await buildMemorySummary(agent.id); if (mem) base += mem; } catch (e) {}
  }
  return base;
}

// ─── @mention helpers ───────────────────────────────────────
const NAME_ALIASES = {};

function parseMentions(text) {
  // Strip [FROM @SENDER → TARGET]: <forwarded text> blocks so that mentions
  // inside forwarded user messages aren't re-dispatched by agents.
  const cleaned = text.replace(/\[FROM\s+@\S+\s*→\s*[^\]]+\]:\s*[^\[\n]*/g, '');
  const set = new Set();
  const re = /@(\w+)/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    let name = m[1].toUpperCase();
    if (NAME_ALIASES[name]) name = NAME_ALIASES[name];
    set.add(name);
  }
  return [...set];
}

function getMentionTargets(mentions) {
  if (mentions.includes('ALL')) {
    return agents.filter(a => true);
  }
  return agents.filter(a =>
    mentions.some(m =>
      a.name.toUpperCase() === m ||          // 精确匹配（如 @MORPHEUS）
      a.name.toUpperCase().includes(m) ||     // 子串匹配（如 @ORACLE → THE ORACLE）
      a.id.toUpperCase() === m                // ID 匹配（如 @oracle）
    )
  );
}

// Highlight @mentions in message text
function renderWithMentions(text) {
  return escapeHtml(text)
    .replace(/@(\w+)/g, '<span class="mention-at">@$1</span>')
    .replace(/\[TOOL:\s*(\w+)\s*([^\]]*)\]/g, '<span class="tool-call">[TOOL: $1 $2]</span>');
}

// ─── Tokenizer for typewriter ───────────────────────────────
function twChunks(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    let w = '';
    while (i < text.length && !/\s/.test(text[i])) { w += text[i++]; }
    if (w) out.push(w);
    let s = '';
    while (i < text.length && /\s/.test(text[i])) { s += text[i++]; }
    if (s) out.push(s);
  }
  return out.length ? out : [text];
}

function twDelay(chunk) {
  if (chunk === '\n') return 200 + Math.random() * 120;
  if (/^\s+$/.test(chunk)) return 60 + Math.random() * 60;
  const len = chunk.length;
  if (len <= 2) return 40 + Math.random() * 30;
  if (len <= 5) return 50 + Math.random() * 40;
  return 60 + Math.random() * 60 + len * 2;
}

// ─── DOM helpers ────────────────────────────────────────────
async function copyMessageText(text, btn) {
  const value = text || '';
  try {
    if (window.electronAPI && window.electronAPI.clipboard && window.electronAPI.clipboard.writeText) {
      window.electronAPI.clipboard.writeText(value);
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    if (btn) {
      const old = btn.textContent;
      btn.textContent = '[ COPIED ]';
      setTimeout(() => { btn.textContent = old; }, 1200);
    }
    showToast('// COPIED //');
  } catch (e) {
    showToast('// COPY FAILED //');
  }
}

function attachMsgCopy(d, text) {
  const btn = d.querySelector('.msg-copy-btn');
  if (!btn) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    copyMessageText(text, btn);
  });
}

function msgMetaHtml() {
  return `<div class="msg-meta"><div class="msg-time">${new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div><button class="msg-copy-btn" type="button">[ COPY ]</button></div>`;
}

function cleanToolDisplayText(text) {
  return (text || '').replace(/[🔍⚡]/g, '').replace(/[ \t]+$/gm, '').trim();
}

function formatToolDisplay(rawText) {
  const raw = rawText || '';
  const toolNames = [...raw.matchAll(/\[TOOL:\s*([^\]]+)\]/g)].map(m => m[1].trim());
  const bodyLines = raw.split('\n').filter(line =>
    !line.includes('[TOOL:') &&
    !line.startsWith('└') &&
    !/^─+$/.test(line.trim())
  );
  const body = cleanToolDisplayText(bodyLines.join('\n'));
  const summary = toolNames.length > 0
    ? `[TOOL: ${toolNames.join(', ')}]`
    : (body.split('\n').find(Boolean) || 'Tool executed');
  return { summary: cleanToolDisplayText(summary), body: body || cleanToolDisplayText(raw) };
}

function createMsgEl(agentId, role, content, streaming, rawText, images) {
  const ag = agents.find(a => a.id === agentId);
  const name = role === 'user' ? 'YOU' : (ag?.name || 'AGENT');
  const d = document.createElement('div');
  const copyText = rawText || content || '';

  if (role === 'tool') {
    d.className = 'msg tool-result';
    const display = formatToolDisplay(copyText);
    const lines = display.body.split('\n');
    const hidden = lines.length > 2 ? ' style="display:none"' : '';

    let imagesHtml = '';
    if (images && images.length > 0) {
      imagesHtml = '<div class="tool-images">';
      for (const img of images) {
        const mime = img.mimeType || 'image/png';
        const dataUri = `data:${mime};base64,${img.data}`;
        imagesHtml += `<img src="${dataUri}" class="msg-screenshot" style="max-width:100%;max-height:500px;margin-top:8px;border:1px solid var(--border);border-radius:4px;" />`;
      }
      imagesHtml += '</div>';
    }

    d.innerHTML = `
      <div class="msg-body">
        <div class="msg-sender tool-sender">Tool Call <span class="tool-toggle">[+]</span></div>
        <div class="tool-summary">${renderWithMentions(display.summary)}${lines.length > 2 ? ' <span class="tool-summary-count">(' + lines.length + ' lines)</span>' : ''}</div>
        ${imagesHtml}
        <div class="msg-bubble tool-bubble"${hidden}>${renderWithMentions(display.body)}</div>
        ${msgMetaHtml()}
      </div>`;
    d.querySelector('.tool-toggle').addEventListener('click', e => {
      e.stopPropagation();
      const bubble = d.querySelector('.tool-bubble');
      const toggle = d.querySelector('.tool-toggle');
      const summary = d.querySelector('.tool-summary');
      if (bubble.style.display === 'none') {
        bubble.style.display = '';
        summary.style.display = 'none';
        toggle.textContent = '[-]';
      } else {
        bubble.style.display = 'none';
        summary.style.display = '';
        toggle.textContent = '[+]';
      }
    });
    attachMsgCopy(d, copyText);
    return d;
  }

  const isSys = role === 'system';
  d.className = `msg ${isSys ? 'system' : (role === 'user' ? 'user' : 'agent')}${streaming ? ' streaming' : ''}`;
  const hasFold = !streaming && !role.startsWith('tool') && content.includes('\n---\n');
  if (hasFold) {
    const parts = content.split('\n---\n');
    const summary = parts[0];
    const extra = parts.slice(1).join('\n---\n');
    d.innerHTML = `
      <div class="msg-body">
        ${isSys ? '' : `<div class="msg-sender">${name}</div>`}
        <div class="msg-bubble long-collapse" data-collapsed="true">
          <div class="long-summary">${summary}</div>
          <div class="long-extra" style="display:none">${extra}</div>
          <div class="long-toggle">[+] Show details</div>
        </div>
        ${msgMetaHtml()}
      </div>`;
    d.querySelector('.long-toggle').addEventListener('click', e => {
      e.stopPropagation();
      const bubble = d.querySelector('.long-collapse');
      const summaryEl = d.querySelector('.long-summary');
      const extraEl = d.querySelector('.long-extra');
      const toggle = d.querySelector('.long-toggle');
      const collapsed = bubble.dataset.collapsed === 'true';
      summaryEl.style.display = collapsed ? 'none' : '';
      extraEl.style.display = collapsed ? '' : 'none';
      toggle.textContent = collapsed ? '[-] Collapse' : '[+] Show details';
      bubble.dataset.collapsed = collapsed ? 'false' : 'true';
    });
  } else {
    d.innerHTML = `
      <div class="msg-body">
        ${isSys ? '' : `<div class="msg-sender">${name}</div>`}
        <div class="msg-bubble">${content}</div>
        ${streaming ? '' : msgMetaHtml()}
      </div>`;
  }
  if (!streaming) attachMsgCopy(d, copyText);
  return d;
}

function appendMsg(area, el) {
  area.appendChild(el);
  area.scrollTop = area.scrollHeight;
  updateEmptyChat();
}

function addThinkingDOM(area) {
  const ag = agents.find(a => a.id === currentAgentId);
  const name = ag?.name || 'AGENT';
  const d = document.createElement('div');
  d.className = 'typing-indicator';
  d.id = 'thinking-indicator';
  d.innerHTML = `<div class="think-shine-text">${name} is thinking</div>`;
  area.appendChild(d);
  area.scrollTop = area.scrollHeight;
}

function removeThinkingDOM() {
  const el = document.getElementById('thinking-indicator');
  if (el) el.remove();
  // Show input area again
  const inputArea = document.querySelector('.input-area');
  if (inputArea) inputArea.classList.remove('hidden');
}

// ─── Track last rendered message count per agent ────────────
const renderedCount = {};
let currentDisplayedAgent = null;          // which agent's messages are currently in the DOM

// ─── Render all messages for an agent ───────────────────────
function renderAgentChat(agentId) {
  const st = ensureState(agentId);
  const area = document.getElementById('messages-area');
  const prevCount = renderedCount[agentId] || 0;

  // If a different agent was displayed, force full rebuild
  if (currentDisplayedAgent !== agentId) {
    renderedCount[agentId] = 0;
  }
  currentDisplayedAgent = agentId;

  const isNewAgent = !renderedCount.hasOwnProperty(agentId) || renderedCount[agentId] === 0;

  // Performance optimization: use document fragment for large updates
  if (isNewAgent || prevCount > st.messages.length) {
    area.innerHTML = '';
    renderedCount[agentId] = 0;
    const fragment = document.createDocumentFragment();
    st.messages.forEach((m, i) => {
      const el = createMsgEl(agentId, m.role, renderWithMentions(m.text), false, m.text, m.images);
      el.dataset.msgIndex = i;
      fragment.appendChild(el);
    });
    area.appendChild(fragment);
  } else if (st.messages.length > prevCount) {
    const fragment = document.createDocumentFragment();
    for (let i = prevCount; i < st.messages.length; i++) {
      const m = st.messages[i];
      // Defensive: skip appending if this message is already rendered in DOM.
      // This guards against finishTyping updating the DOM (streaming→final)
      // while also updating st.messages, before renderAgentChat sees the
      // new renderedCount. Without this guard the same message gets appended
      // twice, producing e.g. “他:456” shown twice.
      const existingEl = area.querySelector(`.msg[data-msg-index=”${i}”]`);
      if (existingEl) {
        // Already in DOM — break out of this loop so the remaining
        // rendering logic (streaming/thinking) still runs.
        break;
      }
      const el = createMsgEl(agentId, m.role, renderWithMentions(m.text), false, m.text, m.images);
      el.dataset.msgIndex = i;
      fragment.appendChild(el);
    }
    if (fragment.children.length > 0) {
      area.appendChild(fragment);
    }
  }
  renderedCount[agentId] = st.messages.length;

  if (st.typing && typeof st.typing.idx === 'number') {
    // Remove old streaming element and re-create
    const oldStreaming = area.querySelector('.msg.streaming');
    if (oldStreaming) oldStreaming.remove();
    const txt = st.typing.partialText || '';
    appendMsg(area, createMsgEl(agentId, 'assistant', escapeHtml(txt) + '<span class="cursor-blink">|</span>', true));
  }
  if (st.isThinking && !(st.typing && typeof st.typing.idx === 'number')) {
    const existingThinker = document.getElementById('thinking-indicator');
    if (!existingThinker) addThinkingDOM(area);
  }
  area.scrollTop = area.scrollHeight;
  updateEmptyChat();
}

// ─── Typewriter engine ──────────────────────────────────────
function startTypewriter(agentId) {
  const st = ensureState(agentId);
  removeThinkingDOM();
  const area = document.getElementById('messages-area');
  const el = createMsgEl(agentId, 'assistant', '<span class="cursor-blink">|</span>', true);
  appendMsg(area, el);
  const bubble = el.querySelector('.msg-bubble');
  st.typing = { chunks: twChunks(st.typing.fullText), idx: 0, partialText: '', msgBubble: bubble };
  twTick(agentId);
}

function twTick(agentId) {
  const st = ensureState(agentId);
  const t = st.typing;
  if (!t || t.idx >= t.chunks.length) { finishTyping(agentId); return; }
  // Guard: if bubble was detached (e.g. session switch), abort gracefully
  if (!t.msgBubble || !t.msgBubble.isConnected) {
    st.typing = null;
    finishTyping(agentId);
    return;
  }
  const chunk = t.chunks[t.idx++];
  t.partialText += chunk;
  t.msgBubble.innerHTML = escapeHtml(t.partialText) + '<span class="cursor-blink">|</span>';
  const area = document.getElementById('messages-area');
  if (area) area.scrollTop = area.scrollHeight;
  t.timer = setTimeout(() => twTick(agentId), twDelay(chunk));
}

function pauseTypewriter(agentId) {
  const st = ensureState(agentId);
  if (st.typing && st.typing.timer) { clearTimeout(st.typing.timer); st.typing.timer = null; }
}

function resumeTypewriter(agentId) {
  const st = ensureState(agentId);
  if (st.typing && !st.typing.timer && st.typing.idx < st.typing.chunks.length) {
    const el = document.getElementById('messages-area')?.querySelector('.msg.streaming .msg-bubble');
    if (el) st.typing.msgBubble = el;
    twTick(agentId);
  }
}

async function finishTyping(agentId) {
  const st = ensureState(agentId);
  if (!st.typing) return;
  const fullText = st.typing.partialText;
  const bubble = st.typing.msgBubble;
  if (bubble && bubble.isConnected) {
    bubble.innerHTML = renderWithMentions(fullText);
    const msgDiv = bubble.closest('.msg');
    if (msgDiv) {
      msgDiv.classList.remove('streaming');
      const meta = document.createElement('div');
      meta.innerHTML = msgMetaHtml();
      const metaEl = meta.firstElementChild;
      msgDiv.querySelector('.msg-body')?.appendChild(metaEl);
      attachMsgCopy(msgDiv, fullText);
    }
  }
  st.typing = null;
  st.isThinking = false;
  const lastMsg = st.messages[st.messages.length - 1];
  if (!lastMsg || lastMsg.role !== 'assistant') {
    st.messages.push({ role: 'assistant', text: fullText, time: Date.now() });
  } else {
    lastMsg.text = fullText; lastMsg.time = Date.now();
  }

  // Sync renderedCount so a later renderAgentChat won't re-append the message
  // that is already rendered as the (now non-streaming) DOM element above.
  const area = document.getElementById('messages-area');
  if (area) {
    const msgEls = area.querySelectorAll('.msg:not(.streaming)');
    renderedCount[agentId] = msgEls.length;
  }

  saveChat(agentId, st.messages);
  const ag = agents.find(a => a.id === agentId);
  if (ag) { ag.lastTime = Date.now(); saveAgents(); renderAgents(); }
  updateEmptyChat();

  // Auto-save conversation memory
  if (typeof autoSaveConversationMemory !== 'undefined') {
    autoSaveConversationMemory(agentId).catch(() => {});
  }

  // Check for TASK_PLAN first (from MORPHEUS or any planner agent)
  const dag = parseTaskPlan(fullText);
  if (dag && currentAgentId === agentId) {
    // Execute as DAG instead of simple @mention routing
    executeTaskDag(dag, fullText);
    return;
  }

  // Fallback: @mention routing for other agents (CODE mode only)
  if (getCurrentMode() === 'code') {
    const mentions = parseMentions(fullText);
    if (mentions.length > 0 && currentAgentId === agentId) {
      const targets = getMentionTargets(mentions).filter(t => t.id !== agentId);
      for (const target of targets) {
        // Send to background agent
        sendToAgent(target.id, fullText, agents.find(a => a.id === agentId)?.name || 'AGENT', agentId, 1);
      }
    }
  }
}

// ─── Route message to a specific agent ──────────────────────
async function sendToAgent(targetAgentId, text, senderName, sourceAgentId, depth) {
  if (depth > MAX_COLLAB_DEPTH) return;
  const targetSt = ensureState(targetAgentId);
  if (targetSt.isThinking) return;

  const targetAg = agents.find(a => a.id === targetAgentId);
  if (!targetAg) return;

  // ── PromptGuard: sanitize cross-agent routed message ──
  const cleanedText = (typeof PromptGuard !== 'undefined' && PromptGuard.sanitizeRoutedMessage)
    ? PromptGuard.sanitizeRoutedMessage(text, sourceAgentId, targetAgentId)
    : text;

  // Strip @mentions from the forwarded text. The [FROM ...] wrapper already
  // tells the target who sent the message, so no @mentions are needed.
  // When user sends "@A @B hello", A sees "hello", not "@B".
  const allAgentNames = agents.map(a => a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const forwardedText = cleanedText
    .replace(new RegExp(`@(${allAgentNames})\\b`, 'gi'), '')
    .replace(/\s+/g, ' ')
    .trim();

  const routedText = `[FROM @${senderName} → ${targetAg.name}]: ${forwardedText}`;
  targetSt.messages.push({ role: 'user', text: routedText, time: Date.now() });
  targetSt.lastTime = Date.now(); // Task: Update activity time on inter-agent message
  targetSt.isThinking = true;
  if (currentAgentId === targetAgentId) renderAgentChat(targetAgentId);
  renderAgents(); // Task: Update sorting immediately

  // Try LangGraph engine first
  const lgOk = await checkLangGraph();
  if (lgOk) {
    setAgentStatus(targetAgentId, 'Engine processing...');
    const history = truncateHistory(targetSt.messages).filter(m => m.role !== 'system');
    const result = await callLangGraph(targetAgentId, routedText, history);
    const reply = result.text || (result.error ? '...Engine error: ' + result.error.slice(0, 80) : '...Link lost.');
    if (result.error) showToast('// LG ERROR: ' + result.error.slice(0, 60) + ' //');

    targetSt.messages.push({ role: 'assistant', text: reply, time: Date.now() });
    targetSt.isThinking = false;
    targetSt.typing = null;
    targetSt.status = '';
    saveChat(targetAgentId, targetSt.messages);
    targetAg.lastTime = Date.now(); saveAgents(); renderAgents();
    if (currentAgentId === targetAgentId) renderAgentChat(targetAgentId);
    if (typeof triggerFileBrowserRefresh === 'function') triggerFileBrowserRefresh();

    const agentMentions = result.mentions || [];
    const targets = agentMentions.map(m => agents.find(a => a.name.toLowerCase() === m.toLowerCase())).filter(Boolean);
    for (const t of targets) {
      if (t.id !== targetAgentId) sendToAgent(t.id, reply, targetAg.name, targetAgentId, depth + 1);
    }
    return;
  }

  // Fallback: manual flow
  const srcSt = agentStates[sourceAgentId];
  const srcAg = agents.find(a => a.id === sourceAgentId);
  const avaliableAgents = agents.filter(a => a.id !== targetAgentId).map(a => a.name).join(', ');

  // Inject persistent memory
  let memorySection = '';
  if (typeof buildMemorySummary !== 'undefined') {
    try { memorySection = await buildMemorySummary(targetAgentId); } catch (e) {}
  }

  const convHistory = [];

  // ── Dynamic tool list rebuilt every call (MCP / skills) ──
  let toolList;
  try {
    if (typeof window.skillRouter !== 'undefined') {
      toolList = await window.skillRouter.selectTools('collaborate', targetAgentId);
    }
  } catch {}
  // Merge in ALL tools from pluginManager (skillRouter only knows indexed tools, misses MCP)
  const pm2 = window.pluginManager;
  const allTools = new Set(toolList ? toolList.split(',').map(s => s.trim()).filter(Boolean) : []);
  if (pm2) {
    for (const name of pm2.tools.keys()) allTools.add(name);
  }
  toolList = Array.from(allTools).join(', ');
  if (!toolList) toolList = '';
  let toolHint = `\n## Tool System — MANDATORY\nALL actions MUST go through tools. NEVER write Python scripts or use run_command when a dedicated tool exists. MCP tools are real desktop capabilities — prefer them. run_command is ONLY for npm/pip/git/build commands.\n\nSyntax: [TOOL: name key="value"]\nAvailable tools: ${toolList}`;
  if (allTools.has('computer-use-mcp.computer')) {
    toolHint += `\n\n## computer-use-mcp.computer — Desktop GUI Control\nActions: get_screenshot (see screen), get_cursor_position, mouse_move, left_click, right_click, double_click, key, type, scroll. For ANY desktop task use this tool — NOT run_command.`;
  }

  convHistory.push(
    { role: 'user', content: 'SYSTEM:' },
    { role: 'assistant', content: `${targetAg.prompt || 'You are a helpful AI agent.'}\n${toolHint}` }
  );

  // ── Dynamic per-call additions ──
  let collabHint = `\nYou are ${targetAg.name}, collaborating in the Matrix.${memorySection}\nReceiving message from @${senderName}. Respond to their request directly.\nAgents available: ${avaliableAgents}. Keep responses focused and actionable.`;

  // ── Code mode: inject collaboration instructions ──
  if (getCurrentMode() === 'code') {
    collabHint += '\n\n## CODE MODE ACTIVE\nYou are collaborating on a software development task. Use @mention routing to delegate subtasks. Prefer tool-based file operations for all code changes.';
  }
  if (srcSt) {
    const recent = srcSt.messages.slice(-4);
    recent.forEach(m => convHistory.push({ role: m.role === 'user' ? 'user' : 'assistant', content: `[${srcAg?.name || 'source'}]: ${m.text}` }));
  }
  convHistory.push({ role: 'user', content: routedText });

  try {
    const reply = await callLLM(convHistory, collabHint, targetAgentId);
    let toolReply = reply;
    let writeWarned = false;
    for (let tld = 0; tld < 3; tld++) {
      const tcs = extractToolCalls(toolReply);
      if (tcs.length === 0) {
        if (!writeWarned && hasWriteIntent(toolReply)) {
          writeWarned = true;
          setAgentStatus(targetAgentId, 'Write intent detected, correcting...');
          targetSt.messages.push({ role: 'assistant', text: toolReply, time: Date.now() });
          const reminder = { role: 'user', content: '你提到了写文件但没有使用 write_file 工具。You MUST use [TOOL: write_file path="..." content="..."] (single-line) or [/TOOL] closing marker (multi-line). IMPORTANT: write_file ONLY accepts "path" and "content". If content has double quotes, use single quotes: content=\'<div class="x">...</div>\'. Do not describe file operations — execute them with the tool.' };
          targetSt.messages.push({ role: 'user', text: reminder.content, time: Date.now() });
          const rh = [
            { role: 'user', content: 'SYSTEM:' },
            { role: 'assistant', content: targetAg.prompt || '' },
            ...targetSt.messages.map(m => ({
              role: m.role === 'user' ? 'user' : 'assistant', content: m.text,
            }))
          ];
          toolReply = await callLLM(rh, collabHint + '\nTool results provided. Continue.', targetAgentId);
          continue;
        }
        break;
      }
      setAgentStatus(targetAgentId, `Running tools [${tcs.map(t => t.name).join(', ')}]...`);
      const tr = [];
      for (const tc of tcs) {
        setAgentStatus(targetAgentId, `Running ${tc.name}...`);
        const toolResult = await executeToolCall(tc, targetAgentId, targetAg.name);
        tr.push(toolResult);
        if (tc.name === 'write_file' || tc.name === 'patch_file') {
          addFileOpMsg(targetAgentId, tc.name, tc.args.path || tc.args.file || '', toolResult);
        }
        setAgentStatus(targetAgentId, `${tc.name} done`);
      }
      setAgentStatus(targetAgentId, 'Analyzing tool results...');
      const to = tr.join('\n\n');
      const fl = tr.filter(r => r.includes('<<TOOL') && r.includes('FAILED'));
      const sa = fl.length > 0 ? `\n## TOOL EXECUTION SUMMARY\n${fl.length} tool(s) FAILED. Do NOT claim success for failed tools.\n` : '';
      targetSt.messages.push({ role: 'assistant', text: toolReply, time: Date.now() });
      targetSt.messages.push({ role: 'tool', text: to + sa, time: Date.now() });
      if (currentAgentId === targetAgentId) renderAgentChat(targetAgentId);
      const nh = [
        { role: 'user', content: 'SYSTEM:' },
        { role: 'assistant', content: targetAg.prompt || '' },
        ...targetSt.messages.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant', content: m.text,
        }))
      ];
      toolReply = await callLLM(nh, collabHint + '\nTool results provided. Continue.', targetAgentId);
    }

    targetSt.status = '';
    targetSt.lastTime = Date.now(); // Task: Update activity time on reply completion
    
    if (currentAgentId === targetAgentId) {
      targetSt.typing = { fullText: toolReply, partialText: '' };
      startTypewriter(targetAgentId);
      targetAg.lastTime = targetSt.lastTime; saveAgents(); renderAgents();
    } else {
      targetSt.messages.push({ role: 'assistant', text: toolReply, time: Date.now() });
      targetSt.isThinking = false;
      targetSt.typing = null;
      saveChat(targetAgentId, targetSt.messages);
      targetAg.lastTime = targetSt.lastTime; saveAgents(); renderAgents();
      if (typeof triggerFileBrowserRefresh === 'function') triggerFileBrowserRefresh();
      if (typeof autoSaveConversationMemory !== 'undefined') {
        autoSaveConversationMemory(targetAgentId).catch(() => {});
      }
      const nestedMentions = parseMentions(toolReply);
      if (getCurrentMode() === 'code' && nestedMentions.length > 0) {
        const nestedTargets = getMentionTargets(nestedMentions).filter(t => t.id !== targetAgentId);
        for (const nt of nestedTargets) {
          sendToAgent(nt.id, toolReply, targetAg.name, targetAgentId, depth + 1);
        }
      }
    }
  } catch (e) {
    setAgentStatus(targetAgentId, 'Connection lost');
    targetSt.isThinking = false;
    targetSt.typing = null;
    targetSt.status = '';
    targetSt.messages.push({ role: 'assistant', text: '...Link lost. Unable to respond.', time: Date.now() });
    saveChat(targetAgentId, targetSt.messages);
    renderAgents();
  }
}

// ─── Send message ───────────────────────────────────────────

// ─── Auto-resize textarea (max 10 lines) ──────────────────
const MAX_AUTO_LINES = 10;

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  const lineH = parseInt(getComputedStyle(el).lineHeight) || 19;
  const maxAutoH = lineH * MAX_AUTO_LINES;
  el.style.height = Math.min(el.scrollHeight, maxAutoH) + 'px';
}

async function sendMessage() {
  const input = document.getElementById('msg-input');
  let text = input.value.trim();
  // Allow sending with only file attachments (no text)
  const hasFiles = (typeof FileUpload !== 'undefined' && FileUpload.getPendingFiles().length > 0);
  if (!text && !hasFiles) return;

  // Resolve //file references from real disk via API
  text = await resolveFileRefs(text);

  // ── Auto-detect code mode triggers ──
  if (triggersCodeMode(text)) {
    setSessionMode('code');
    text = text.replace(CODE_MODE_TRIGGERS, '').trim();
  }

  // ── PromptGuard: sanitize user input ──
  if (typeof PromptGuard !== 'undefined' && PromptGuard.sanitizeUserInput) {
    const guardResult = PromptGuard.sanitizeUserInput(text);
    if (guardResult.blocked) {
      showToast('// INPUT BLOCKED: ' + guardResult.warnings[0].slice(0, 60) + ' //');
      return;
    }
    text = guardResult.sanitized;
    if (guardResult.warnings.length > 0) {
      console.log('[PromptGuard]', guardResult.warnings.join('; '));
    }
  }

  // ── Append file attachments to message text ──
  if (typeof FileUpload !== 'undefined' && FileUpload.getPendingFiles().length > 0) {
    const fileCtx = FileUpload.buildFileContext();
    text = text + fileCtx;
    FileUpload.clearPendingFiles(); // clear chips after send
  }

  if (!currentAgentId) { showToast('SELECT AN AGENT FIRST'); return; }

  const currentAg = agents.find(a => a.id === currentAgentId);
  if (!currentAg) return;

  input.value = '';
  input.style.height = 'auto';

  // Parse @mentions
  const mentions = parseMentions(text);

  if (mentions.length > 0 && getCurrentMode() === 'code') {
    // ── ROUTED: send to mentioned agents (CODE mode only) ──
    const targets = getMentionTargets(mentions);

    // Show user message in current agent's chat
    const st = ensureState(currentAgentId);
    st.messages.push({ role: 'user', text, time: Date.now() });
    st.lastTime = Date.now(); // Task: Update activity time on user input
    renderAgentChat(currentAgentId);
    renderAgents(); // Task: Update sorting immediately

    // Send to each target (including the current agent if @all)
    for (const target of targets) {
      if (target.id === currentAgentId) {
        // Current agent processes it directly
        processCurrentAgentReply(currentAgentId, text);
      } else {
        await sendToAgent(target.id, text, currentAg.name, currentAgentId, 0);
      }
    }

    // If @all, also send to agents not in the viewing panel
    if (mentions.includes('ALL')) {
      showToast('// DISPATCHING TO ALL AGENTS //');
    } else {
      showToast(`// DISPATCHING TO ${targets.filter(t => t.id !== currentAgentId).length} AGENTS //`);
    }
  } else if (mentions.length > 0 && getCurrentMode() === 'chat') {
    // ── CHAT mode: @mentions are stripped, treat as normal message ──
    const allAgentNames = agents.map(a => a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    text = text.replace(new RegExp(`@(${allAgentNames})\\b`, 'gi'), '').replace(/\s+/g, ' ').trim();
    showToast('// CHAT MODE — responding as selected agent //');
  } else {
    // ── NORMAL or STEERING: single agent ──
    const st = ensureState(currentAgentId);
    if (st.isThinking) {
      // STEERING: Abort current LLM call and redirect
      abortAgent(currentAgentId);
      // Stop typewriter if active
      if (st.typing && st.typing.timer) { clearTimeout(st.typing.timer); }
      const partialText = st.typing ? st.typing.partialText : '';
      st.typing = null;
      removeThinkingDOM();
      // Save partial text as cancelled marker
      if (partialText) {
        st.messages.push({ role: 'assistant', text: partialText, time: Date.now() });
        st.messages.push({ role: 'system', text: '// [STEERED] Response interrupted by user //', time: Date.now() });
      }
      // Inject user's steering message
      st.messages.push({ role: 'user', text: text, time: Date.now() });
      st.lastTime = Date.now();
      renderAgentChat(currentAgentId);
      renderAgents();
      showToast('// STEERING //');
      processCurrentAgentReply(currentAgentId, text);
      return;
    }
    st.messages.push({ role: 'user', text, time: Date.now() });
    st.lastTime = Date.now(); // Task: Update activity time on user input
    st.isThinking = true;
    renderAgentChat(currentAgentId);
    renderAgents(); // Task: Update sorting immediately

    // ── Auto-generate session title on first message ──
    const session = (typeof getCurrentSession === 'function') ? getCurrentSession() : null;
    if (session && session.title && session.title.startsWith('SESSION_') && typeof SessionModel !== 'undefined') {
      SessionModel.generateSessionTitle(text, currentAgentId); // fire-and-forget
    }

    processCurrentAgentReply(currentAgentId, text);
  }
}

async function processCurrentAgentReply(agentId, userText) {
  const st = ensureState(agentId);
  const ag = agents.find(a => a.id === agentId);
  if (!ag) return;

  const signal = newAgentAbort(agentId);

  // Try LangGraph engine first
  const lgOk = await checkLangGraph();
  if (lgOk) {
    setAgentStatus(agentId, 'Engine processing...');
    const history = truncateHistory(st.messages).filter(m => m.role !== 'system');
    const result = await callLangGraph(agentId, userText, history);
    const reply = result.text || '...No response from engine.';
    if (result.error) showToast('// LG ERROR: ' + result.error.slice(0, 60) + ' //');

    st.messages.push({ role: 'assistant', text: reply, time: Date.now() });
    st.typing = null;
    st.isThinking = false;
    st.status = '';
    saveChat(agentId, st.messages);
    ag.lastTime = Date.now(); saveAgents(); renderAgents();
    if (currentAgentId === agentId) renderAgentChat(agentId);
    if (typeof triggerFileBrowserRefresh === 'function') triggerFileBrowserRefresh();

    // Handle @mentions from LangGraph response
    const agentMentions = result.mentions || [];
    const targets = agentMentions.map(m => agents.find(a => a.name.toLowerCase() === m.toLowerCase())).filter(Boolean);
    for (const t of targets) {
      if (t.id !== agentId) sendToAgent(t.id, reply, ag.name, agentId, 1);
    }
    return;
  }

  // Fallback: manual LLM + tool loop
  let convHistory = truncateHistory(st.messages).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text,
  }));

  // ── Build static system prompt (agent role + tool syntax) ──
  // Role + syntax embedded once as conversation preamble (KV-cache dedup)
  // Tool LIST is dynamic — selected per-message by SkillRouter
  let staticSystemPrompt = ag.prompt || 'You are a helpful AI assistant.';
  const toolSyntaxPrompt = `\n\n## Tool System — MANDATORY
You have access to a tool system. ALL actions MUST go through tools — you are FORBIDDEN from writing Python scripts or using run_command as a workaround when a dedicated tool exists.

Tool priority:
1. First check the tools list below — is there a tool that does what you need? Use it.
2. MCP tools (computer-use-mcp.*) are real desktop/OS capabilities — prefer them over scripting.
3. Skills (prefixed with name.) provide domain-specific abilities — use them when available.
4. run_command is ONLY for: npm/pip install, git operations, build scripts, test runners. NOT for desktop tasks.

TOOL SYNTAX:
[TOOL: tool_name key="value"]
For multi-line content: [TOOL: tool_name key="value" key2="value2"] ... [/TOOL]

__TOOLS_PLACEHOLDER__

IMPORTANT: The write_file tool ONLY accepts "path" and "content" parameters. Do NOT add any other parameters like lang, charset, id, class, style, type, src, href — those are HTML attributes, NOT tool parameters. If the file content contains double quotes ("), wrap the content value in single quotes (') instead.

# ❌ WRONG (do NOT do this):
[TOOL: write_file path="index.html" lang="zh-CN" charset="UTF-8" id="main" class="container"]
# ✅ CORRECT (single line, use ] as closer):
[TOOL: write_file path="index.html" content='<!DOCTYPE html><html lang="zh-CN"><body>Hello</body></html>']
# ✅ CORRECT (multi-line, use [/TOOL] as closer):
[TOOL: write_file path="index.html" content='<!DOCTYPE html>
<html lang="zh-CN">
<head><title>Dashboard</title></head>
<body>
  <div id="app">Hello</div>
</body>
</html>'
[/TOOL]

Example: [TOOL: read_file path="src/index.js"]
You can call multiple tools in one response. The tool results will be provided after execution.`;

  // Build dynamic tool list via SkillRouter (two-stage recall + dedup) + always merge MCP
  let availableToolsHint = 'Available tools: ';
  let skillList = '';
  if (typeof window.skillRouter !== 'undefined') {
    try {
      skillList = await window.skillRouter.selectTools(userText, agentId);
    } catch (e) { /* fallback below */ }
  }
  // Merge skillRouter result with ALL tools in pluginManager (catches MCP & newly registered tools)
  const pm = window.pluginManager;
  let merged = new Set();
  if (pm) {
    merged = new Set(skillList ? skillList.split(',').map(s => s.trim()).filter(Boolean) : []);
    for (const name of pm.tools.keys()) merged.add(name);
    availableToolsHint = 'Available tools: ' + Array.from(merged).join(', ') + '.';
  } else {
    availableToolsHint = 'Available tools: ' + (skillList || '') + '.';
  }

  // Inject MCP tool usage guides so agent knows how to use them
  if (merged && merged.has('computer-use-mcp.computer')) {
    availableToolsHint += `\n\n## computer-use-mcp.computer — Desktop GUI Control (MANDATORY for desktop tasks)
This is the ONLY tool you should use for desktop/screen/mouse/keyboard tasks. DO NOT write Python scripts or use run_command for desktop operations.
ALWAYS call get_screenshot FIRST to see what's on screen before any other action.
Usage: [TOOL: computer-use-mcp.computer action="ACTION" coordinate="0,0" text="VALUE"]
Actions:
- get_screenshot — Capture the screen. ALWAYS DO THIS FIRST.
- get_cursor_position — Get mouse (x,y) position.
- mouse_move coordinate="x,y" — Move the mouse cursor.
- left_click — Left mouse click. Can add coordinate to move there first.
- right_click — Right mouse click.
- double_click — Double-click. Use this to open desktop icons.
- left_click_drag coordinate="x,y" — Click and drag to target position.
- key text="ctrl+c" — Press a key or key combination (e.g. win, ctrl+c, alt+tab, enter).
- type text="words" — Type text at current cursor position.
- scroll coordinate="x,y" text="down:300" — Scroll at position (up/down/left/right, optional :pixels).`;
  }

  // Inject selected tool list into the syntax prompt
  const finalToolSyntax = toolSyntaxPrompt.replace('__TOOLS_PLACEHOLDER__', availableToolsHint);

  // Always inject fresh system prompt (tool list includes recently registered MCP/skills)
  convHistory = [
    { role: 'user', content: 'SYSTEM:' },
    { role: 'assistant', content: staticSystemPrompt + finalToolSyntax },
    ...convHistory
  ];

  // ── Build dynamic system prompt (tools + memory + skills + collab) ──
  let dynamicSystemPrompt = '';

  // Inject persistent memory into system prompt
  if (typeof buildMemorySummary !== 'undefined') {
    try {
      const memSummary = await buildMemorySummary(agentId);
      if (memSummary) dynamicSystemPrompt += memSummary;
    } catch (e) {}
  }
  // Inject installed skill prompts
  if (typeof window._getSkillPromptInjection === 'function') {
    const skillPrompts = window._getSkillPromptInjection();
    if (skillPrompts) dynamicSystemPrompt += '\n\n' + skillPrompts;
  }
  const otherAgents = agents.filter(a => a.id !== agentId);
  if (otherAgents.length > 0) {
    dynamicSystemPrompt += `\n\nYou can collaborate with other agents: ${otherAgents.map(a => a.name).join(', ')}. To delegate a task to another agent, write @AgentName: instruction in your response. Use @all to address everyone.`;
  }

  // ── Code mode: inject collaboration instructions ──
  if (getCurrentMode() === 'code') {
    dynamicSystemPrompt += '\n\n## CODE MODE ACTIVE\nYou are in a collaborative software development session. Agents work together using @mentions to delegate subtasks. Use tools for all file operations and testing. When you need another agent to do work, write @AgentName: instruction. When the task is complex, use @all to dispatch to the team.';
  }

  try {
    let reply = await callLLM(convHistory, dynamicSystemPrompt, agentId, signal);
    // Check if steered (aborted). The sender already handles the restart.
    if (reply.startsWith('// [STEERED]')) { st.isThinking = false; st.status = ''; return; }
    let writeIntentWarned = false;

    let toolLoopDepth = 0;
    while (toolLoopDepth < 5) {
      const toolCalls = extractToolCalls(reply);
      if (toolCalls.length === 0) {
        if (!writeIntentWarned && hasWriteIntent(reply)) {
          writeIntentWarned = true;
          setAgentStatus(agentId, 'Write intent detected, correcting...');
          st.messages.push({ role: 'assistant', text: reply, time: Date.now() });
          if (currentAgentId === agentId) renderAgentChat(agentId);
          const writeReminder = { role: 'user', content: '你提到了写文件但没有使用 write_file 工具。You MUST use [TOOL: write_file path="..." content="..."] (single-line) or [/TOOL] closing marker (multi-line). IMPORTANT: write_file ONLY accepts "path" and "content". If content has double quotes, use single quotes: content=\'<div class="x">...</div>\'. Do not describe file operations — execute them with the tool.' };
          st.messages.push({ role: 'user', text: writeReminder.content, time: Date.now() });
          const retryHistory = [
            { role: 'user', content: 'SYSTEM:' },
            { role: 'assistant', content: staticSystemPrompt + finalToolSyntax },
            ...st.messages.map(m => ({
              role: m.role === 'user' ? 'user' : 'assistant',
              content: m.text,
            }))
          ];
          reply = await callLLM(retryHistory, dynamicSystemPrompt, agentId, signal);
          toolLoopDepth++;
          continue;
        }
        break;
      }
      toolLoopDepth++;
      setAgentStatus(agentId, `Running tools [${toolCalls.map(t => t.name).join(', ')}]...`);
      if (currentAgentId === agentId) {
        st.messages.push({ role: 'assistant', text: reply, time: Date.now() });
        renderAgentChat(agentId);
      }
      const results = [];
      for (const tc of toolCalls) {
        setAgentStatus(agentId, `Running ${tc.name}...`);
        const toolResult = await executeToolCall(tc, agentId, ag.name);
        results.push(toolResult);
        if (tc.name === 'write_file' || tc.name === 'patch_file') {
          addFileOpMsg(agentId, tc.name, tc.args.path || tc.args.file || '', typeof toolResult === 'object' && toolResult.text ? toolResult.text : toolResult);
        }
        setAgentStatus(agentId, `${tc.name} done`);
      }
      setAgentStatus(agentId, 'Analyzing tool results...');
      const allImages = [];
      const textResults = results.map(r => {
        if (typeof r === 'object' && r !== null && r.images && r.images.length > 0) {
          allImages.push(...r.images);
          return r.text || '';
        }
        return r;
      });
      const toolOutput = textResults.join('\n\n');
      const failures = textResults.filter(r => typeof r === 'string' && r.includes('<<TOOL') && r.includes('FAILED'));
      const summary = failures.length > 0
        ? `\n## TOOL EXECUTION SUMMARY\n${failures.length} tool(s) FAILED. Do NOT claim success for failed tools. Review each <<TOOL FAILED>> block above and fix the issue.\n`
        : '';
      if (currentAgentId !== agentId) st.messages.push({ role: 'assistant', text: reply, time: Date.now() });
      const toolMsg = { role: 'tool', text: toolOutput + summary, time: Date.now() };
      if (allImages.length > 0) toolMsg.images = allImages;
      st.messages.push(toolMsg);
      if (currentAgentId === agentId) renderAgentChat(agentId);
      const newHistory = [
        { role: 'user', content: 'SYSTEM:' },
        { role: 'assistant', content: staticSystemPrompt + finalToolSyntax },
        ...st.messages.map(m => {
          const role = m.role === 'user' ? 'user' : (m.role === 'system' ? 'user' : 'assistant');
          if (m.images && m.images.length > 0) {
            const content = [{ type: 'text', text: m.text }];
            for (const img of m.images) {
              content.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType || 'image/png', data: img.data } });
            }
            return { role, content };
          }
          return { role, content: m.text };
        })
      ];
      reply = await callLLM(newHistory, dynamicSystemPrompt + '\n\nThe tool results have been provided above. Continue with your response based on these results. If you need to call more tools, you can. Otherwise, provide your final response to the user.', agentId, signal);
    }

    // Guard: if steered, don't continue
    if (reply.startsWith('// [STEERED]')) { st.isThinking = false; st.status = ''; return; }

    // ── Guardrails: check agent output for secrets/sensitive data ──
    let displayReply = reply;
    if (typeof Guardrails !== 'undefined' && Guardrails.checkAgentOutput) {
      const outputCheck = Guardrails.checkAgentOutput(reply);
      if (!outputCheck.safe) {
        const findings = outputCheck.findings.map(f => `${f.type}:${f.label}`).join(', ');
        console.warn(`[Guardrails] Agent ${ag.name} output had ${outputCheck.findings.length} findings: ${findings}`);
      }
      displayReply = outputCheck.sanitized;
    }

    st.status = '';
    st.typing = { fullText: displayReply, partialText: '' };
    st.lastTime = Date.now(); // Task: Update activity time on completion
    
    if (currentAgentId === agentId) {
      startTypewriter(agentId);
      ag.lastTime = st.lastTime; saveAgents(); renderAgents();
    } else {
      st.messages.push({ role: 'assistant', text: displayReply, time: Date.now() });
      st.isThinking = false; st.typing = null;
      saveChat(agentId, st.messages);
      ag.lastTime = st.lastTime; saveAgents(); renderAgents();
    }
    if (typeof triggerFileBrowserRefresh === 'function') triggerFileBrowserRefresh();
  } catch (e) {
    // If aborted by steering, just clean up silently
    if (e.name === 'AbortError' || (signal && signal.aborted)) {
      st.isThinking = false; st.typing = null; st.status = '';
      return;
    }
    setAgentStatus(agentId, 'System interrupted');
    st.isThinking = false; st.typing = null;
    st.status = '';
    st.messages.push({ role: 'assistant', text: '...System disturbance. Signal unstable.', time: Date.now() });
    if (currentAgentId === agentId) renderAgentChat(agentId);
    saveChat(agentId, st.messages);
  }
}

// ─── Select agent ───────────────────────────────────────────
function selectAndRenderChat(agentId) {
  if (currentAgentId && agentStates[currentAgentId]) pauseTypewriter(currentAgentId);
  currentAgentId = agentId;
  
  // Task 4: Keep currentSession metadata in sync
  const session = typeof getCurrentSession === 'function' ? getCurrentSession() : null;
  if (session) {
    session.lastActiveAgentId = agentId;
    if (typeof persistCurrentSession === 'function') persistCurrentSession();
  }

  const ag = agents.find(a => a.id === agentId);
  if (!ag) return;
  document.querySelector('.chat-header-name').textContent = ag.name;
  document.querySelector('.chat-header-role').textContent = ag.role;
  renderAgentChat(agentId);
  resumeTypewriter(agentId);
}

function startNewAgentChat(agentId) {
  const st = ensureState(agentId);
  st.messages = [];
  if (st.typing) { clearTimeout(st.typing.timer); st.typing = null; }
  st.isThinking = false;
  newChatFile(agentId);
  if (agentId === currentAgentId) renderAgentChat(agentId);
}

function getAgentMessages(agentId) { return ensureState(agentId).messages; }
function setAgentMessages(agentId, msgs) {
  const st = ensureState(agentId);
  st.messages = msgs; st.isThinking = false;
  if (st.typing) { clearTimeout(st.typing.timer); st.typing = null; }
  // Task 4: Ensure messages are saved to the current session
  if (typeof saveChat === 'function') saveChat(agentId, msgs);
}

function updateEmptyChat() {
  const el = document.getElementById('emptyChat');
  if (!el) return;
  const st = currentAgentId ? agentStates[currentAgentId] : null;
  el.style.display = (!st || st.messages.length === 0) ? 'flex' : 'none';
}

// ─── @mention autocomplete ──────────────────────────────────
let mentionIdx = -1;

function hideMentionDropdown() { document.getElementById('mention-dropdown').style.display = 'none'; mentionIdx = -1; }

function showMentionDropdown(filter) {
  const dd = document.getElementById('mention-dropdown');
  const matches = agents.filter(a =>
    a.name.toLowerCase().includes(filter.toLowerCase())
  );
  if (filter === '' || 'all'.startsWith(filter.toLowerCase())) {
    matches.unshift({ id: '__all__', name: 'all', role: '// ALL AGENTS //' });
  }
  if (matches.length === 0) { dd.style.display = 'none'; return; }
  dd.innerHTML = matches.map((a, i) =>
    `<div class="mention-item ${i === 0 ? 'selected' : ''}" data-name="${a.name.toLowerCase()}">
      ${a.avatar ? `<img class="mention-avatar" src="${a.avatar}">` : '<span class="mention-def">◉</span>'}
      <span class="mention-name">${a.name}</span>
      <span class="mention-role">${a.role || '// AGENT //'}</span>
    </div>`
  ).join('');
  dd.style.display = 'block';
  mentionIdx = 0;
}

function selectMention() {
  const dd = document.getElementById('mention-dropdown');
  const sel = dd.querySelector('.mention-item.selected');
  if (!sel) return;
  const name = sel.dataset.name;
  insertMention(name);
}

function insertMention(name) {
  const input = document.getElementById('msg-input');
  const val = input.value;
  const pos = input.selectionStart;
  const before = val.slice(0, pos);
  const after = val.slice(pos);
  const atMatch = before.match(/@(\w*)$/);
  if (!atMatch) return;
  const start = pos - atMatch[0].length;
  input.value = before.slice(0, start) + '@' + name + ' ' + after;
  const newPos = start + name.length + 2;
  input.setSelectionRange(newPos, newPos);
  input.focus();
  hideMentionDropdown();
  autoResizeTextarea(input);
}

// ─── Keyboard / UI events ───────────────────────────────────
// ─── //file resolver ────────────────────────────────────────
// Resolves //file path patterns to real disk file contents via API
// Reading is unrestricted; only writes are gated by whitelist.
async function resolveFileRefs(text) {
  const promises = [];
  const replacements = {};

  const ea = (typeof window !== 'undefined' && window.electronAPI) ? window.electronAPI : null;
  text.replace(/\/\/file\s+(\S+)/g, (match, filePath) => {
    const key = match;
    if (!replacements[key]) {
      replacements[key] = null;
      promises.push(
        (ea ? ea.fs.read(filePath) : Promise.resolve({ error: 'Electron API not available' }))
          .then(data => {
            if (data.error) {
              replacements[key] = `\`\`\`\n// ERROR: ${data.error}\n\`\`\``;
            } else {
              const name = filePath.split(/[\\/]/).pop();
              const ext = filePath.endsWith('.json') ? 'json' : '';
              replacements[key] = `[File: ${name} (${filePath})]\n\`\`\`${ext}\n${data.content}\n\`\`\``;
            }
          })
          .catch(() => {
            replacements[key] = `\`\`\`\n// ERROR: Failed to read file\n\`\`\``;
          })
      );
    }
  });

  await Promise.all(promises);
  let result = text;
  for (const [key, val] of Object.entries(replacements)) {
    result = result.replace(key, val);
  }
  return result;
}

// ─── //file autocomplete ────────────────────────────────────
let fileIdx = -1;
let fsCache = {};          // simple cache: path -> entry list

async function fetchFileList(path) {
  if (fsCache[path]) return fsCache[path];
  try {
    const ea = (typeof window !== 'undefined' && window.electronAPI) ? window.electronAPI : null;
    if (!ea) return [];
    const data = await ea.fs.list(path, false);
    if (Array.isArray(data)) fsCache[path] = data;
    return data;
  } catch (e) { return []; }
}

function formatEntry(e) {
  return e.type === 'drive' ? e.name : e.path;
}

function showFileDropdown(filter) {
  const dd = document.getElementById('file-dropdown');
  if (!dd) return;

  const filterLower = (filter || '').toLowerCase();

  // Determine which directory to list from filesystem
  let listPath = '';
  if (!filter) {
    listPath = '';
  } else if (filter.match(/^[A-Za-z]:\\?$/)) {
    listPath = filter.replace(/\\$/, '') + '\\';
  } else {
    const norm = filter.replace(/\\/g, '/');
    const lastSlash = norm.lastIndexOf('/');
    listPath = lastSlash > 0 ? norm.slice(0, lastSlash).replace(/\//g, '\\') : filter;
  }

  // Fetch filesystem listing
  fetchFileList(listPath).then(fsEntries => {
    let results = [];

    // Filesystem entries that match the filter
    if (Array.isArray(fsEntries)) {
      let filtered = fsEntries;
      if (filterLower) {
        filtered = fsEntries.filter(e => formatEntry(e).toLowerCase().includes(filterLower));
      }
      filtered.forEach(e => {
        const fullPath = formatEntry(e);
        results.push({ name: e.name, path: fullPath, type: e.type, source: 'fs' });
      });
    }

    if (results.length === 0) { dd.style.display = 'none'; fileIdx = -1; return; }

    dd.innerHTML = results.map((r, i) => {
      const isDir = r.type === 'dir' || r.type === 'drive';
      return `<div class="file-item ${i === 0 ? 'selected' : ''}" data-path="${r.path}" data-type="${r.type}">
        <span class="file-item-icon">${isDir ? '▸' : '◈'}</span>
        <span class="file-item-path">${escapeHtml(r.name)}</span>
      </div>`;
    }).join('');
    dd.style.display = 'block';
    fileIdx = 0;
  }).catch(() => { dd.style.display = 'none'; });
}

function hideFileDropdown() {
  const dd = document.getElementById('file-dropdown');
  if (dd) dd.style.display = 'none';
  fileIdx = -1;
}

function selectFileItem() {
  const dd = document.getElementById('file-dropdown');
  const sel = dd.querySelector('.file-item.selected');
  if (!sel) return;
  const path = sel.dataset.path;
  const type = sel.dataset.type;

  if (type === 'dir' || type === 'drive') {
    // Navigate into directory: insert path without closing dropdown
    const input = document.getElementById('msg-input');
    const val = input.value;
    const pos = input.selectionStart;
    const before = val.slice(0, pos);
    const after = val.slice(pos);
    const match = before.match(/(\/\/file\s*)(\S*)$/);
    if (!match) return;
    const start = pos - match[0].length;
    const newPrefix = '//file ' + path + '\\';
    input.value = before.slice(0, start) + newPrefix + after;
    const newPos = start + newPrefix.length;
    input.setSelectionRange(newPos, newPos);
    input.focus();
    // Trigger re-list for the new directory
    showFileDropdown(path + '\\');
    autoResizeTextarea(input);
    return;
  }

  // Select a file: insert full path and keep it as a reference
  insertFilePath(path);
}

function insertFilePath(path) {
  const input = document.getElementById('msg-input');
  const val = input.value;
  const after = val.slice(input.selectionStart);
  const before = val.slice(0, input.selectionStart);
  const match = before.match(/(\/\/file\s*)(\S*)$/);
  if (!match) return;
  const start = input.selectionStart - match[0].length;
  input.value = before.slice(0, start) + '//file ' + path + ' ' + after;
  const newPos = start + 7 + path.length + 1;
  input.setSelectionRange(newPos, newPos);
  input.focus();
  hideFileDropdown();
  autoResizeTextarea(input);
}

// Detect if cursor is inside a //file prefix
function getFileQuery(input) {
  const pos = input.selectionStart;
  const before = input.value.slice(0, pos);
  const m = before.match(/(\/\/file\s+)(\S*)$/);
  return m ? m[2] || '' : null;
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('msg-input');
  const dd = document.getElementById('mention-dropdown');
  const fdd = document.getElementById('file-dropdown');

  document.getElementById('send-btn').addEventListener('click', sendMessage);

  function hideAllDropdowns() { hideMentionDropdown(); hideFileDropdown(); }

  // ── Input detection: @mention OR //file ──
  input.addEventListener('input', function () {
    autoResizeTextarea(this);

    const pos = this.selectionStart;
    const before = this.value.slice(0, pos);

    // Check //file first
    const fq = getFileQuery(this);
    if (fq !== null) {
      hideMentionDropdown();
      showFileDropdown(fq);
      return;
    }
    // Then @mention
    const atMatch = before.match(/@(\w*)$/);
    if (atMatch) {
      hideFileDropdown();
      showMentionDropdown(atMatch[1]);
    } else {
      hideAllDropdowns();
    }
  });

  // Cursor re-position: re-check on click
  input.addEventListener('click', function () {
    const pos = this.selectionStart;
    const before = this.value.slice(0, pos);
    const fq = getFileQuery(this);
    if (fq !== null) { hideMentionDropdown(); showFileDropdown(fq); return; }
    const atMatch = before.match(/@(\w*)$/);
    if (atMatch) { hideFileDropdown(); showMentionDropdown(atMatch[1]); return; }
    hideAllDropdowns();
  });

  // ── Keyboard navigation + submit ──
  input.addEventListener('keydown', e => {
    const ddFile = fdd.style.display === 'block';
    const ddMention = dd.style.display === 'block';

    // //file dropdown navigation
    if (ddFile) {
      const items = fdd.querySelectorAll('.file-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        fileIdx = Math.min(fileIdx + 1, items.length - 1);
        items.forEach((el, i) => el.classList.toggle('selected', i === fileIdx));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        fileIdx = Math.max(fileIdx - 1, 0);
        items.forEach((el, i) => el.classList.toggle('selected', i === fileIdx));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectFileItem();
        return;
      }
      if (e.key === 'Escape') { hideFileDropdown(); return; }
    }

    // @mention dropdown navigation
    if (ddMention) {
      const items = dd.querySelectorAll('.mention-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        mentionIdx = Math.min(mentionIdx + 1, items.length - 1);
        items.forEach((el, i) => el.classList.toggle('selected', i === mentionIdx));
        items[mentionIdx]?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        mentionIdx = Math.max(mentionIdx - 1, 0);
        items.forEach((el, i) => el.classList.toggle('selected', i === mentionIdx));
        items[mentionIdx]?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectMention();
        return;
      }
      if (e.key === 'Escape') { hideMentionDropdown(); return; }
    }

    // Send on Enter (only when no dropdown active)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Click-to-select in mention dropdown
  dd.addEventListener('mousedown', e => {
    const item = e.target.closest('.mention-item');
    if (item) { e.preventDefault(); insertMention(item.dataset.name); }
  });

  // Click-to-select in file dropdown
  fdd.addEventListener('mousedown', e => {
    const item = e.target.closest('.file-item');
    if (item) { e.preventDefault(); insertFilePath(item.dataset.path); }
  });

  // Close dropdowns on blur
  input.addEventListener('blur', () => setTimeout(hideAllDropdowns, 200));

  // Escape globally
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideAllDropdowns(); });

});
