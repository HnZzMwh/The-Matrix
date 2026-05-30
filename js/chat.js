// ============================================================
// CHAT — Concurrent per-agent messaging + typewriter effect
// ============================================================

// ─── Per-agent runtime state ─────────────────────────────────
const agentStates = {};
const MAX_COLLAB_DEPTH = 3;

function ensureState(agentId) {
  if (!agentStates[agentId]) {
    agentStates[agentId] = {
      messages: [],
      isThinking: false,
      typing: null,
    };
  }
  return agentStates[agentId];
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
//   B: @ANDERSON :: instruction :: deps: [A]
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
  const convHistory = [
    { role: 'system',
      content: buildDagSystemPrompt(targetAg, dag) +
        '\n\n## Tool System\nAvailable: read_file, write_file, code_search, list_dir, read_multiple, run_command.\nUse [TOOL: tool_name key="value"] syntax.' },
    { role: 'user', content: routedText },
  ];

  try {
    let reply = await callLLM(convHistory, targetAg.prompt || '');

    // Tool loop (up to 3 iterations)
    for (let tld = 0; tld < 3; tld++) {
      const tcs = extractToolCalls(reply);
      if (tcs.length === 0) break;
      const results = [];
      for (const tc of tcs) {
        const tr = await executeToolCall(tc, task.agentId, targetAg.name);
        results.push(tr);
        // Track file writes
        if (tc.name === 'write_file') dag.recordFileWrite(tc.args.path || tc.args.file || '', task.id);
      }
      st.messages.push({ role: 'assistant', text: reply, time: Date.now() });
      st.messages.push({ role: 'tool', text: results.join('\n\n'), time: Date.now() });
      const nh = st.messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant', content: m.text,
      }));
      reply = await callLLM(nh, targetAg.prompt + '\nTool results provided. Continue.');
    }

    task.result = reply;
    task.status = 'done';
    st.messages.push({ role: 'assistant', text: reply, time: Date.now() });
    st.isThinking = false;
    if (currentAgentId === task.agentId) renderAgentChat(task.agentId);
    saveChat(task.agentId, st.messages);
    targetAg.lastTime = Date.now(); saveAgents(); renderAgents();

  } catch (e) {
    task.status = 'failed';
    task.result = e.message || 'Task failed';
    st.messages.push({ role: 'assistant', text: `[TASK ${task.id} FAILED]: ${task.result}`, time: Date.now() });
    st.isThinking = false;
    saveChat(task.agentId, st.messages);
  }
}

function buildDagSystemPrompt(agent, dag) {
  const allAgentNames = agents.filter(a => a.id !== agent.id).map(a => a.name).join(', ');
  return `You are ${agent.name}. You are executing a task in a DAG workflow.
Available agents: ${allAgentNames}.
You may use tools: [TOOL: tool_name key="value"]
Available tools: read_file, write_file, patch_file, repo_scan, repo_tree, find_symbol, find_imports, code_search, list_dir, read_multiple, run_command, run_test, test_report, native_build, generate_tests, analyze_test_failure, save_arch_rules, query_arch, check_arch_violation, scan_deps, scan_side_effects, scan_scalability, audit_file, parse_stack_trace, diagnose_runtime, trace_root_cause, check_ownership, build_symbol_graph, relevant_context, cross_file_check, acquire_lock, release_lock, request_ownership, my_pending_requests, call_graph, setup_venv, save_schema, register_consumer, schema_impact, web_search, web_fetch.
Complete your task and report results concisely.`;
}

// ─── @mention helpers ───────────────────────────────────────
function parseMentions(text) {
  const set = new Set();
  const re = /@(\w+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    set.add(m[1].toUpperCase());
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
function createMsgEl(agentId, role, content, streaming) {
  const ag = agents.find(a => a.id === agentId);
  const name = role === 'user' ? 'YOU' : (ag?.name || 'AGENT');
  const d = document.createElement('div');

  if (role === 'tool') {
    // Tool result messages — terminal-style block
    d.className = 'msg tool-result';
    d.innerHTML = `
      <div class="msg-body">
        <div class="msg-sender tool-sender">${name} ⚡</div>
        <div class="msg-bubble tool-bubble">${content}</div>
        <div class="msg-time">${new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div>
      </div>`;
    return d;
  }

  const isSys = role === 'system';
  d.className = `msg ${isSys ? 'system' : (role === 'user' ? 'user' : 'agent')}${streaming ? ' streaming' : ''}`;
  d.innerHTML = `
    <div class="msg-body">
      ${isSys ? '' : `<div class="msg-sender">${name}</div>`}
      <div class="msg-bubble">${content}</div>
      ${streaming ? '' : `<div class="msg-time">${new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div>`}
    </div>`;
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

// ─── Render all messages for an agent ───────────────────────
function renderAgentChat(agentId) {
  const st = ensureState(agentId);
  const area = document.getElementById('messages-area');
  const prevCount = renderedCount[agentId] || 0;
  const isNewAgent = !renderedCount.hasOwnProperty(agentId);

  if (isNewAgent || prevCount > st.messages.length) {
    // Full rebuild needed (new agent or messages trimmed)
    area.innerHTML = '';
    renderedCount[agentId] = 0;
    st.messages.forEach((m, i) => {
      const el = createMsgEl(agentId, m.role, renderWithMentions(m.text), false);
      el.dataset.msgIndex = i;
      appendMsg(area, el);
    });
  } else if (st.messages.length > prevCount) {
    // Incremental: only append new messages
    for (let i = prevCount; i < st.messages.length; i++) {
      const m = st.messages[i];
      const el = createMsgEl(agentId, m.role, renderWithMentions(m.text), false);
      el.dataset.msgIndex = i;
      appendMsg(area, el);
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
  const bubble = st.typing.msgBubble;
  if (bubble && bubble.isConnected) {
    bubble.innerHTML = renderWithMentions(st.typing.partialText);
    const msgDiv = bubble.closest('.msg');
    if (msgDiv) {
      msgDiv.classList.remove('streaming');
      const t = document.createElement('div');
      t.className = 'msg-time';
      t.textContent = new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      msgDiv.querySelector('.msg-body')?.appendChild(t);
    }
  }
  const fullText = st.typing.partialText;
  st.typing = null;
  st.isThinking = false;
  const lastMsg = st.messages[st.messages.length - 1];
  if (!lastMsg || lastMsg.role !== 'assistant') {
    st.messages.push({ role: 'assistant', text: fullText, time: Date.now() });
  } else {
    lastMsg.text = fullText; lastMsg.time = Date.now();
  }
  saveChat(agentId, st.messages);
  const ag = agents.find(a => a.id === agentId);
  if (ag) { ag.lastTime = Date.now(); saveAgents(); renderAgents(); }
  updateEmptyChat();

  // Check for TASK_PLAN first (from MORPHEUS or any planner agent)
  const dag = parseTaskPlan(fullText);
  if (dag && currentAgentId === agentId) {
    // Execute as DAG instead of simple @mention routing
    executeTaskDag(dag, fullText);
    return;
  }

  // Fallback: @mention routing for other agents
  const mentions = parseMentions(fullText);
  if (mentions.length > 0 && currentAgentId === agentId) {
    const targets = getMentionTargets(mentions).filter(t => t.id !== agentId);
    for (const target of targets) {
      // Send to background agent
      await sendToAgent(target.id, fullText, agents.find(a => a.id === agentId)?.name || 'AGENT', agentId, 1);
    }
  }
}

// ─── Route message to a specific agent ──────────────────────
async function sendToAgent(targetAgentId, text, senderName, sourceAgentId, depth) {
  if (depth > MAX_COLLAB_DEPTH) return;
  const targetSt = ensureState(targetAgentId);
  if (targetSt.isThinking) return; // busy

  const targetAg = agents.find(a => a.id === targetAgentId);
  const srcAg = agents.find(a => a.id === sourceAgentId);
  if (!targetAg) return;

  // Build routed message
  const routedText = `[FROM @${senderName} → ${targetAg.name}]: ${text}`;
  targetSt.messages.push({ role: 'user', text: routedText, time: Date.now() });
  targetSt.isThinking = true;

  // If viewing this agent, show immediately
  if (currentAgentId === targetAgentId) renderAgentChat(targetAgentId);
  renderAgents(); // update thinking indicator

  // Build context: include the source agent's recent messages for context
  const srcSt = agentStates[sourceAgentId];
  const avaliableAgents = agents.filter(a => a.id !== targetAgentId).map(a => a.name).join(', ');
  const convHistory = [
    { role: 'system', content: `You are ${targetAg.name}. You are collaborating with other agents in the Matrix.
When another agent addresses you with @${targetAg.name}, respond to their request directly.
You may delegate subtasks to other agents by writing @AgentName: instruction in your response.
Agents available: ${avaliableAgents}.
Keep responses focused and actionable.

## Tool System
You have access to a tool system. Use the following syntax to use tools:
[TOOL: tool_name key="value"]
Available tools: read_file, write_file, patch_file, repo_scan, repo_tree, find_symbol, find_imports, code_search, list_dir, read_multiple, run_command, run_test, test_report, native_build, generate_tests, analyze_test_failure, github_pr, github_actions, plan_task, task_report, search_knowledge, save_checkpoint, list_checkpoints, restore_checkpoint, show_history, save_arch_rules, query_arch, check_arch_violation, scan_deps, scan_side_effects, scan_scalability, audit_file, parse_stack_trace, diagnose_runtime, trace_root_cause, check_ownership, build_symbol_graph, relevant_context, cross_file_check, acquire_lock, release_lock, request_ownership, my_pending_requests, call_graph, setup_venv, save_schema, register_consumer, schema_impact, web_search, web_fetch.
Example: [TOOL: read_file path="src/index.js"]` },
  ];
  // Add recent context from both agents
  if (srcSt) {
    const recent = srcSt.messages.slice(-4);
    recent.forEach(m => convHistory.push({ role: m.role === 'user' ? 'user' : 'assistant', content: `[${srcAg?.name || 'source'}]: ${m.text}` }));
  }
  convHistory.push({ role: 'user', content: routedText });

  try {
    const reply = await callLLM(convHistory, targetAg.prompt || 'You are a helpful AI agent.');

    // Tool loop for background agent
    let toolReply = reply;
    for (let tld = 0; tld < 3; tld++) {
      const tcs = extractToolCalls(toolReply);
      if (tcs.length === 0) break;
      const tr = [];
      for (const tc of tcs) tr.push(await executeToolCall(tc, targetAgentId, targetAg.name));
      const to = tr.join('\n\n');
      targetSt.messages.push({ role: 'assistant', text: toolReply, time: Date.now() });
      targetSt.messages.push({ role: 'tool', text: to, time: Date.now() });
      const nh = targetSt.messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant', content: m.text,
      }));
      toolReply = await callLLM(nh, targetAg.prompt + '\nTool results provided. Continue.');
    }

    targetSt.typing = { fullText: toolReply, partialText: '' };
    if (currentAgentId === targetAgentId) {
      startTypewriter(targetAgentId);
    } else {
      targetSt.messages.push({ role: 'assistant', text: toolReply, time: Date.now() });
      targetSt.isThinking = false;
      targetSt.typing = null;
      saveChat(targetAgentId, targetSt.messages);
      targetAg.lastTime = Date.now(); saveAgents(); renderAgents();

      // Check for further @mentions in this background response
      const nestedMentions = parseMentions(toolReply);
      if (nestedMentions.length > 0) {
        const nestedTargets = getMentionTargets(nestedMentions).filter(t => t.id !== targetAgentId);
        for (const nt of nestedTargets) {
          await sendToAgent(nt.id, toolReply, targetAg.name, targetAgentId, depth + 1);
        }
      }
    }
  } catch (e) {
    targetSt.isThinking = false;
    targetSt.typing = null;
    targetSt.messages.push({ role: 'assistant', text: '...Link lost. Unable to respond.', time: Date.now() });
    saveChat(targetAgentId, targetSt.messages);
    renderAgents();
  }
}

// ─── Send message ───────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('msg-input');
  let text = input.value.trim();
  if (!text) return;

  // Resolve //file references from real disk via API
  text = await resolveFileRefs(text);
  if (!currentAgentId) { showToast('SELECT AN AGENT FIRST'); return; }

  const currentAg = agents.find(a => a.id === currentAgentId);
  if (!currentAg) return;

  input.value = '';
  input.style.height = 'auto';

  // Parse @mentions
  const mentions = parseMentions(text);

  if (mentions.length > 0) {
    // ── ROUTED: send to mentioned agents ──
    const targets = getMentionTargets(mentions);

    // Show user message in current agent's chat
    const st = ensureState(currentAgentId);
    st.messages.push({ role: 'user', text, time: Date.now() });
    renderAgentChat(currentAgentId);

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
  } else {
    // ── NORMAL: single agent ──
    const st = ensureState(currentAgentId);
    if (st.isThinking) { showToast('// AGENT IS ALREADY RESPONDING //'); return; }
    st.messages.push({ role: 'user', text, time: Date.now() });
    st.isThinking = true;
    renderAgentChat(currentAgentId);
    processCurrentAgentReply(currentAgentId, text);
  }
}

async function processCurrentAgentReply(agentId, userText) {
  const st = ensureState(agentId);
  const ag = agents.find(a => a.id === agentId);
  if (!ag) return;

  const convHistory = st.messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text,
  }));

  let systemPrompt = ag.prompt || 'You are a helpful AI assistant.';
  const otherAgents = agents.filter(a => a.id !== agentId);
  // ── Collaboration note (for ALL agents, including user-created) ──
  if (otherAgents.length > 0) {
    systemPrompt += `\n\nYou can collaborate with other agents: ${otherAgents.map(a => a.name).join(', ')}. To delegate a task to another agent, write @AgentName: instruction in your response. Use @all to address everyone.`;
  }
  // ── Tool syntax note (for ALL agents, so user-created ones can use tools too) ──
  systemPrompt += `\n\n## Tool System
You have access to a tool system. When you need to read/write files, run commands, or use any tool, include the following syntax in your response:
[TOOL: tool_name key="value"]
Available tools: read_file, write_file, patch_file, repo_scan, repo_tree, find_symbol, find_imports, code_search, list_dir, read_multiple, run_command, run_test, test_report, native_build, generate_tests, analyze_test_failure, github_pr, github_actions, plan_task, task_report, search_knowledge, save_checkpoint, list_checkpoints, restore_checkpoint, show_history, save_arch_rules, query_arch, check_arch_violation, scan_deps, scan_side_effects, scan_scalability, audit_file, parse_stack_trace, diagnose_runtime, trace_root_cause, check_ownership, build_symbol_graph, relevant_context, cross_file_check, acquire_lock, release_lock, request_ownership, my_pending_requests, call_graph, setup_venv, save_schema, register_consumer, schema_impact, web_search, web_fetch.
Example: [TOOL: read_file path="src/index.js"]
You can call multiple tools in one response. The tool results will be provided after execution.`;

  try {
    let reply = await callLLM(convHistory, systemPrompt);

    // Tool call loop: check if response contains tool calls, execute, re-prompt
    let toolLoopDepth = 0;
    while (toolLoopDepth < 5) {
      const toolCalls = extractToolCalls(reply);
      if (toolCalls.length === 0) break;
      toolLoopDepth++;

      // Execute tool calls
      const results = [];
      for (const tc of toolCalls) {
        const toolResult = await executeToolCall(tc, agentId, ag.name);
        results.push(toolResult);
      }
      const toolOutput = results.join('\n\n');

      // Add the response+tool results as context, re-prompt the agent
      st.messages.push({ role: 'assistant', text: reply, time: Date.now() });
      st.messages.push({ role: 'tool', text: toolOutput, time: Date.now() });

      const newHistory = st.messages.map(m => ({
        role: m.role === 'user' ? 'user' : (m.role === 'system' ? 'user' : 'assistant'),
        content: m.text,
      }));

      reply = await callLLM(newHistory, systemPrompt + '\n\nThe tool results have been provided above. Continue with your response based on these results. If you need to call more tools, you can. Otherwise, provide your final response to the user.');
    }

    st.typing = { fullText: reply, partialText: '' };
    if (currentAgentId === agentId) {
      startTypewriter(agentId);
      ag.lastTime = Date.now(); saveAgents(); renderAgents();
    } else {
      st.messages.push({ role: 'assistant', text: reply, time: Date.now() });
      st.isThinking = false; st.typing = null;
      saveChat(agentId, st.messages);
      ag.lastTime = Date.now(); saveAgents(); renderAgents();
    }
  } catch (e) {
    st.isThinking = false; st.typing = null;
    st.messages.push({ role: 'assistant', text: '...System disturbance. Signal unstable.', time: Date.now() });
    if (currentAgentId === agentId) renderAgentChat(agentId);
    saveChat(agentId, st.messages);
  }
}

// ─── Select agent ───────────────────────────────────────────
function selectAndRenderChat(agentId) {
  if (currentAgentId && agentStates[currentAgentId]) pauseTypewriter(currentAgentId);
  currentAgentId = agentId;
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
  if (agentId === currentAgentId) renderAgentChat(agentId);
}

function getAgentMessages(agentId) { return ensureState(agentId).messages; }
function setAgentMessages(agentId, msgs) {
  const st = ensureState(agentId);
  st.messages = msgs; st.isThinking = false;
  if (st.typing) { clearTimeout(st.typing.timer); st.typing = null; }
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
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
}

// ─── Keyboard / UI events ───────────────────────────────────
// ─── //file resolver ────────────────────────────────────────
// Resolves //file path patterns to real disk file contents via API
// Only allows reading files within whitelisted paths.
async function resolveFileRefs(text) {
  const whitelist = getWhitelist();
  const promises = [];
  const replacements = {};

  text.replace(/\/\/file\s+(\S+)/g, (match, filePath) => {
    const key = match;
    if (!replacements[key]) {
      // Check whitelist: path must start with a whitelisted entry
      const allowed = whitelist.some(wp => filePath.startsWith(wp));
      if (!allowed) {
        replacements[key] = `\`\`\`\n// ACCESS DENIED: "${filePath}" is not in the file whitelist.\n// Use [ FILES ] panel to add paths to your whitelist.\n\`\`\``;
        return;
      }

      replacements[key] = null;
      promises.push(
        fetch('/api/read?path=' + encodeURIComponent(filePath))
          .then(r => r.json())
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
    const resp = await fetch('/api/list?path=' + encodeURIComponent(path));
    const data = await resp.json();
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

  // Get whitelisted paths that match the filter
  const wl = (typeof getWhitelist === 'function') ? getWhitelist() : [];
  const filterLower = (filter || '').toLowerCase();
  const wlMatches = wl.filter(p => p.toLowerCase().includes(filterLower));

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

    // 1. Whitelist matches (priority, show with WL badge)
    wlMatches.forEach(p => {
      const name = p.split(/[\\/]/).pop() || p;
      results.push({ name, path: p, type: 'file', source: 'whitelist' });
    });

    // 2. Filesystem entries that match the filter
    if (Array.isArray(fsEntries)) {
      let filtered = fsEntries;
      if (filterLower) {
        filtered = fsEntries.filter(e => formatEntry(e).toLowerCase().includes(filterLower));
      }
      // Deduplicate by path
      const existing = new Set(results.map(r => r.path));
      filtered.forEach(e => {
        const fullPath = formatEntry(e);
        if (!existing.has(fullPath)) {
          results.push({ name: e.name, path: fullPath, type: e.type, source: 'fs' });
          existing.add(fullPath);
        }
      });
    }

    if (results.length === 0) { dd.style.display = 'none'; fileIdx = -1; return; }

    dd.innerHTML = results.map((r, i) => {
      const isDir = r.type === 'dir' || r.type === 'drive';
      const isWL = r.source === 'whitelist';
      return `<div class="file-item ${i === 0 ? 'selected' : ''}" data-path="${r.path}" data-type="${r.type}">
        <span class="file-item-icon">${isDir ? '▸' : '◈'}</span>
        <span class="file-item-path">${escapeHtml(r.name)}</span>
        ${isWL ? '<span class="file-item-badge">WL</span>' : ''}
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
    const match = before.match(/(\/\/file\s*)(\S*)$/);
    if (!match) return;
    const start = pos - match[0].length;
    const newPrefix = '//file ' + path + '\\';
    input.value = before.slice(0, start) + newPrefix + after + (after || '');
    const newPos = start + newPrefix.length;
    input.setSelectionRange(newPos, newPos);
    input.focus();
    // Trigger re-list for the new directory
    showFileDropdown(path + '\\');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
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
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
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
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';

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
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        mentionIdx = Math.max(mentionIdx - 1, 0);
        items.forEach((el, i) => el.classList.toggle('selected', i === mentionIdx));
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
