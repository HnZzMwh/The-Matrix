// ============================================================
// TOOLS — Virtual workspace & agent tool execution engine
// ============================================================

// ─── Virtual Workspace (in-memory file system) ──────────────
const WORKSPACE = {
  files: {},
  _init() {
    if (Object.keys(this.files).length > 0) return;
    this.files = {
      '/workspace/README.md': '# MATRIX Development Workspace\n\nWelcome to the Matrix collaborative coding environment.',
      '/workspace/package.json': JSON.stringify({
        name: 'matrix-workspace', version: '1.0.0',
        scripts: { test: 'echo "Tests passed!"', build: 'echo "Build complete."' },
      }, null, 2),
      '/workspace/src/index.js': '// Main entry point\nconsole.log("Matrix system initialized.");\n',
      '/workspace/src/utils/helpers.js': '// Helper functions\n\nexport function formatTime(ts) {\n  return new Date(ts).toISOString();\n}\n',
    };
  },
  readFile(path) {
    this._init();
    const p = this._resolve(path);
    if (!this.files[p]) return `// ERROR: File not found: ${p}`;
    return this.files[p];
  },
  writeFile(path, content) {
    this._init();
    const p = this._resolve(path);
    this.files[p] = content;
    return `// Written ${content.length} bytes to ${p}`;
  },
  searchFiles(query) {
    this._init();
    if (!query) return '// No query provided';
    const results = [];
    for (const [path, content] of Object.entries(this.files)) {
      const lines = content.split('\n');
      const matches = [];
      lines.forEach((line, i) => {
        if (line.toLowerCase().includes(query.toLowerCase())) {
          matches.push(`  L${i + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
      if (matches.length > 0) {
        results.push(`📄 ${path} (${matches.length} matches):\n${matches.join('\n')}`);
      }
    }
    return results.length > 0 ? results.join('\n\n') : `// No results for "${query}"`;
  },
  listDir(path) {
    this._init();
    const p = this._resolve(path);
    const prefix = p.endsWith('/') ? p : p + '/';
    const entries = new Set();
    for (const f of Object.keys(this.files)) {
      if (f.startsWith(prefix)) {
        const rel = f.slice(prefix.length);
        const parts = rel.split('/');
        entries.add(parts[0] + (parts.length > 1 ? '/' : ''));
      }
    }
    return [...entries].sort().map(e => `  ${e}`).join('\n') || '// (empty directory)';
  },
  deleteFile(path) {
    const p = this._resolve(path);
    if (!this.files[p]) return `// ERROR: File not found: ${p}`;
    delete this.files[p];
    return `// Deleted: ${p}`;
  },
  _resolve(path) {
    if (!path) return '/workspace';
    // Simple path resolution, no .. traversal allowed
    if (path.includes('..') || path.includes('~') || path.startsWith('/etc') || path.startsWith('/root') || path.startsWith('/home') || path.startsWith('/var') || path.startsWith('/usr') || path.startsWith('/bin') || path.startsWith('/dev')) {
      return '// ACCESS DENIED: Path outside workspace boundary';
    }
    // Normalize: remove double slashes, ensure starts with /workspace
    let p = path.replace(/\/+/g, '/');
    if (!p.startsWith('/')) p = '/workspace/' + p;
    if (p.startsWith('/workspace')) return p;
    return '/workspace/' + p.replace(/^\//, '');
  },
};

// ─── Regex helper ───────────────────────────────────────────
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Test log ───────────────────────────────────────────────
const TEST_LOG = [];

function runTest(name, code) {
  const id = 'test_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const result = { id, name, passed: Math.random() > 0.15, output: `Running test: ${name}...\n` };
  // Simulate test execution
  result.output += result.passed
    ? `✓ PASS: ${name}\n  ${Math.floor(Math.random() * 50) + 1} assertions passed`
    : `✗ FAIL: ${name}\n  Expected "matrix" but received "matrx" at line 42`;
  TEST_LOG.push(result);
  return result;
}

function testReport() {
  if (TEST_LOG.length === 0) return '// No tests have been run yet.';
  const passed = TEST_LOG.filter(t => t.passed).length;
  const total = TEST_LOG.length;
  return `📊 Test Report: ${passed}/${total} passed (${Math.round(passed/total*100)}%)\n` +
    TEST_LOG.map(t => `  ${t.passed ? '✓' : '✗'} ${t.name}`).join('\n');
}

// ─── Task planner (Morpheus) ────────────────────────────────
let taskBoard = [];

function planTask(description, assignee) {
  const task = {
    id: 'TASK-' + (taskBoard.length + 1),
    description,
    assignee: assignee || 'UNASSIGNED',
    status: 'PENDING',
    createdAt: Date.now(),
  };
  taskBoard.push(task);
  return `// 📋 Task Created: ${task.id}\n//   "${description}" → @${assignee}\n//   Status: ${task.status}`;
}

function updateTask(taskId, newStatus) {
  const task = taskBoard.find(t => t.id === taskId.toUpperCase());
  if (!task) return `// ERROR: Task ${taskId} not found`;
  task.status = newStatus;
  return `// ✅ Task ${taskId} → ${newStatus}`;
}

function taskReport() {
  if (taskBoard.length === 0) return '// No tasks yet.';
  const pending = taskBoard.filter(t => t.status !== 'DONE' && t.status !== 'CLOSED');
  return `📋 Task Board (${pending.length} active):\n` +
    taskBoard.map(t => `  [${t.status}] ${t.id}: ${t.description} → @${t.assignee}`).join('\n');
}

// ─── Tool dispatcher ────────────────────────────────────────
// Agents write: [TOOL: toolName param="value"]
// Returns tool result text for injection into conversation

const TOOL_DEFS = {
  // ── Anderson's tools ──
  read_file: {
    desc: 'Read file content from workspace',
    run: (args) => WORKSPACE.readFile(args.path || args.file || args._),
  },
  readfile: { // alias for / without underscore
    desc: '',
    run: (args) => WORKSPACE.readFile(args.path || args.file || args._),
  },
  write_file: {
    desc: 'Write content to a file on real disk (path must be in write whitelist)',
    run: async (args) => {
      const path = args.path || args.file;
      const content = args.content || '';
      if (typeof isPathWhitelisted !== 'function' || !isPathWhitelisted(path)) {
        return `// BLOCKED: "${path}" not in write whitelist.\n// Add the parent directory via [FILES] panel first, then retry.`;
      }
      try {
        const resp = await fetch('/api/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content }),
        });
        const data = await resp.json();
        if (data.success) {
          return `// Written ${data.size} bytes to ${data.path}`;
        }
        return `// ERROR: ${data.error || 'write failed'}`;
      } catch (e) {
        return `// ERROR: ${e.message || 'server unreachable'}`;
      }
    },
  },
  // ── Repository Awareness tools ──
  repo_scan: {
    desc: 'Scan repository structure — list files in whitelisted directories',
    run: async (args) => {
      const path = args.path || args.dir || '';
      try {
        const url = path
          ? `/api/list?path=${encodeURIComponent(path)}&recursive=true`
          : '/api/list?path=&recursive=true';
        const resp = await fetch(url);
        const data = await resp.json();
        if (!Array.isArray(data)) return `// Cannot access: ${data.error || path || '(root)'}`;
        if (data.length === 0) return '// (empty directory)';
        // Group by directory
        const dirs = {};
        for (const e of data) {
          const dir = e.folder || '';
          if (!dirs[dir]) dirs[dir] = [];
          dirs[dir].push(e.name);
        }
        const lines = [];
        for (const [dir, files] of Object.entries(dirs)) {
          if (!files) continue;
          lines.push(`${dir || '.'}/`);
          for (const f of files) lines.push(`  ${f}`);
        }
        return `📁 Repository scan: ${data.length} items\n${lines.join('\n').slice(0, 5000)}`;
      } catch (e) {
        return `// ERROR: ${e.message}`;
      }
    },
  },
  repo_tree: {
    desc: 'Show full directory tree of a whitelisted path',
    run: async (args) => {
      const path = args.path || args.dir || '.';
      try {
        const resp = await fetch(`/api/list?path=${encodeURIComponent(path)}`);
        const data = await resp.json();
        if (!Array.isArray(data)) return `// Cannot access: ${path}`;
        const indent = (level) => '  '.repeat(level);
        const lines = [`📂 ${path}`];
        for (const e of data) {
          const isDir = e.type === 'dir' || e.type === 'drive';
          if (e.name === '.') continue;
          const icon = isDir ? '📁' : '📄';
          lines.push(`  ${icon} ${e.name}`);
        }
        return lines.join('\n').slice(0, 3000);
      } catch (e) {
        return `// ERROR: ${e.message}`;
      }
    },
  },
  // ── Symbol-level tools ──
  find_symbol: {
    desc: 'Find symbol definitions (class, function, import, export) across project files',
    run: async (args) => {
      const symbol = args.symbol || args.name || args.query || '';
      if (!symbol) return '// Provide a symbol name: symbol="handleLogin"';
      const path = args.path || '';
      try {
        const searchUrl = path
          ? `/api/search?query=${encodeURIComponent(symbol)}&roots=${encodeURIComponent(path)}`
          : `/api/search?query=${encodeURIComponent(symbol)}&roots=`;
        const resp = await fetch(searchUrl);
        const data = await resp.json();
        if (!Array.isArray(data) || data.length === 0) {
          return `// Symbol "${symbol}" not found in project files.`;
        }
        // Read matching files and search for symbol patterns
        const matches = [];
        let fileCount = 0;
        for (const entry of data.slice(0, 10)) {
          try {
            const fileResp = await fetch(`/api/read?path=${encodeURIComponent(entry.path)}`);
            const fileData = await fileResp.json();
            if (fileData.error) continue;
            const content = fileData.content || '';
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              const symLower = symbol.toLowerCase();
              const lineLower = line.toLowerCase();
              if (lineLower.includes(symLower)) {
                const role = line.match(/\b(function|class|const|let|var|import|export|interface|type)\b/i);
                const label = role ? `[${role[1].toUpperCase()}]` : '[REF]';
                matches.push(`  ${label} ${entry.path}:${i + 1}  ${line.trim().slice(0, 120)}`);
                if (matches.length >= 15) break;
              }
            }
          } catch (e) { continue; }
          fileCount++;
          if (matches.length >= 15) break;
        }
        if (matches.length === 0) return `// Symbol "${symbol}": found in ${fileCount} files but no definition detected. Try a broader search.`;
        return `🔍 Symbol "${symbol}" — ${matches.length} references:\n${matches.join('\n')}`;
      } catch (e) {
        return `// ERROR: ${e.message}`;
      }
    },
  },
  find_imports: {
    desc: 'Find all import/require statements in a file',
    run: async (args) => {
      const path = args.path || args.file || '';
      if (!path) return '// Provide a file path: path="src/index.js"';
      try {
        const resp = await fetch(`/api/read?path=${encodeURIComponent(path)}`);
        const data = await resp.json();
        if (data.error) return `// ERROR: ${data.error}`;
        const content = data.content || '';
        const lines = content.split('\n');
        const imports = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (/^(import|const|let|var).*?(from|require)\s/.test(line) || line.startsWith('import') || line.includes('require(')) {
            imports.push(`  L${i + 1}: ${line.slice(0, 150)}`);
          }
        }
        if (imports.length === 0) return `// No import statements found in ${path}`;
        return `📦 Imports in ${path} (${imports.length}):\n${imports.join('\n')}`;
      } catch (e) {
        return `// ERROR: ${e.message}`;
      }
    },
  },
  // ── Incremental Editing ──
  patch_file: {
    desc: 'Apply a surgical text replacement in an existing file (read -> replace -> write)',
    run: async (args) => {
      const path = args.path || args.file || '';
      const oldStr = args.old || args.find || args.old_str || '';
      const newStr = args.new || args.replace || args.new_str || '';
      if (!path || !oldStr) return '// Usage: [TOOL: patch_file path="src/app.js" old="old text" new="new text"]';
      // Check whitelist
      if (typeof isPathWhitelisted !== 'function' || !isPathWhitelisted(path)) {
        return `// BLOCKED: "${path}" not in whitelist.`;
      }
      try {
        // Read current file
        const readResp = await fetch(`/api/read?path=${encodeURIComponent(path)}`);
        const readData = await readResp.json();
        if (readData.error) return `// ERROR reading ${path}: ${readData.error}`;
        const content = readData.content || '';
        // Count occurrences
        const occurrences = (content.match(new RegExp(escapeRegex(oldStr), 'g')) || []).length;
        if (occurrences === 0) return `// ERROR: string not found in ${path}`;
        if (occurrences > 1 && !args.all) {
          return `// WARNING: "${oldStr}" appears ${occurrences} times. Use all=true to replace all, or narrow the old string.`;
        }
        const newContent = args.all
          ? content.split(oldStr).join(newStr)
          : content.replace(oldStr, newStr);
        // Write back
        const writeResp = await fetch('/api/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content: newContent }),
        });
        const writeData = await writeResp.json();
        if (writeData.success) {
          return `// Patch applied to ${path}: replaced ${occurrences} occurrence(s). File size: ${newContent.length} bytes.`;
        }
        return `// ERROR: ${writeData.error || 'write failed'}`;
      } catch (e) {
        return `// ERROR: ${e.message}`;
      }
    },
  },
  code_search: {
    desc: 'Search for text across all workspace files',
    run: (args) => WORKSPACE.searchFiles(args.query || args.text || ''),
  },
  list_dir: {
    desc: 'List files in a directory',
    run: (args) => WORKSPACE.listDir(args.path || '.'),
  },
  delete_file: {
    desc: 'Delete a file from workspace',
    run: (args) => WORKSPACE.deleteFile(args.path || args.file),
  },
  read_multiple: {
    desc: 'Read multiple files at once',
    run: (args) => {
      const paths = (args.paths || args.files || '').split(',').map(s => s.trim());
      return paths.map(p => `=== ${p} ===\n${WORKSPACE.readFile(p)}`).join('\n\n');
    },
  },

  // ── Testing & Execution tools (no Docker required) ──
  run_test: {
    desc: 'Run tests via real pytest/jest/npm-test through the server',
    run: async (args) => {
      const name = args.name || args.file || '';
      const cmd = args.cmd || '';
      const cwd = args.cwd || '';
      // Build the command
      let fullCmd = cmd;
      if (!fullCmd) {
        if (name.endsWith('.py') || name.includes('pytest')) fullCmd = `pytest ${name} -v 2>&1`;
        else if (name.endsWith('.test.js') || name.includes('jest')) fullCmd = `npx jest ${name} --no-coverage 2>&1`;
        else if (name.endsWith('.spec.ts')) fullCmd = `npx jest ${name} --no-coverage 2>&1`;
        else fullCmd = `pytest ${name} -v 2>&1`;
      }
      try {
        const resp = await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd: fullCmd, cwd: cwd || undefined, capability: 'test' }),
        });
        const data = await resp.json();
        if (data.error) return `// ERROR: ${data.error}`;
        let out = `$ ${fullCmd}\n`;
        out += data.stdout || '';
        if (data.stderr) out += `\n--- STDERR ---\n${data.stderr}`;
        out += `\n--- EXIT CODE: ${data.exit_code} ---`;
        if (data.summary) {
          const s = data.summary;
          const parts = [];
          if (s.passed !== undefined) parts.push(`${s.passed} passed`);
          if (s.failed !== undefined) parts.push(`${s.failed} failed`);
          if (s.errors !== undefined) parts.push(`${s.errors} errors`);
          if (parts.length > 0) out += `\n📊 Summary: ${parts.join(', ')}`;
          if (s.first_failure) out += `\n🔍 First Failure: ${s.first_failure}`;
        }
        // Log to test log
        const result = {
          id: 'test_' + Date.now(),
          name: name || fullCmd,
          passed: data.success,
          output: out,
        };
        if (typeof TEST_LOG !== 'undefined') TEST_LOG.push(result);
        return out.slice(0, 5000);
      } catch (e) {
        return `// ERROR: ${e.message || 'server unreachable'}`;
      }
    },
  },
  test_report: {
    desc: 'Show test results summary',
    run: () => testReport(),
  },
  run_command: {
    desc: 'Execute a terminal command via the server (build, lint, git, etc.)',
    run: async (args) => {
      const cmd = args.cmd || args.command || '';
      const cwd = args.cwd || '';
      if (!cmd) return '// Provide a command: cmd="npm run build"';
      // Direct sim for common git commands (safe for any system)
      if (cmd.startsWith('git diff') || cmd.startsWith('git status')) {
        return `$ ${cmd}\n// Git operations are read-only and safe.\n// Use run_test for actual test execution.`;
      }
      try {
        const resp = await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd, cwd: cwd || undefined, capability: 'build' }),
        });
        const data = await resp.json();
        if (data.error) return `// ERROR: ${data.error}`;
        let out = `$ ${cmd}\n`;
        out += data.stdout || '';
        if (data.stderr) out += `\n--- STDERR ---\n${data.stderr}`;
        out += `\n--- EXIT CODE: ${data.exit_code} ---`;
        return out.slice(0, 5000);
      } catch (e) {
        return `// ERROR: ${e.message || 'server unreachable'}`;
      }
    },
  },
  native_build: {
    desc: 'Build project natively (npm/pip) — no Docker required',
    run: async (args) => {
      const cmd = args.cmd || args.command || '';
      const cwd = args.cwd || '';
      const buildCmd = cmd || (args.lang === 'python' ? 'python -m build' : 'npm run build');
      try {
        const resp = await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd: buildCmd, cwd: cwd || undefined, capability: 'build' }),
        });
        const data = await resp.json();
        if (data.error) return `// ERROR: ${data.error}`;
        let out = `$ ${buildCmd}\n`;
        out += data.stdout || '';
        if (data.stderr) out += `\n--- STDERR ---\n${data.stderr}`;
        out += `\n--- EXIT CODE: ${data.exit_code} ---`;
        return out.slice(0, 3000);
      } catch (e) {
        return `// ERROR: ${e.message || 'server unreachable'}`;
      }
    },
  },
  // ── Test Generation & Analysis ──
  generate_tests: {
    desc: 'Generate test file for a source file (pytest for .py, jest for .js)',
    run: async (args) => {
      const path = args.path || args.file || '';
      const framework = args.framework || '';
      if (!path) return '// Usage: [TOOL: generate_tests path="src/app.py"] or [TOOL: generate_tests path="src/utils.js" framework="jest"]';
      try {
        const resp = await fetch(`/api/read?path=${encodeURIComponent(path)}`);
        const data = await resp.json();
        if (data.error) return `// ERROR: ${data.error}`;
        const content = data.content || '';
        const lines = content.split('\n');
        const funcs = [];
        const classes = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          const f = line.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/);
          if (f) funcs.push({ name: f[1], line: i + 1, code: line.slice(0, 80) });
          const c = line.match(/^(?:export\s+)?class\s+(\w+)/);
          if (c) classes.push({ name: c[1], line: i + 1 });
          const a = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
          if (a) funcs.push({ name: a[1], line: i + 1, code: line.slice(0, 80) });
        }
        const isPy = path.endsWith('.py');
        let testCode = '';
        if (isPy) {
          const modName = path.split(/[\\/]/).pop().replace('.py', '');
          testCode = `# Auto-generated tests for ${path}\n# Run: pytest ${path.replace('.py', '_test.py')} -v\n\nimport pytest\nfrom ${modName} import *\n\n`;
          for (const fn of funcs) {
            if (fn.name.startsWith('_')) continue;
            testCode += `\ndef test_${fn.name}():\n    """Test ${fn.name} — ${fn.code}"""\n    # TODO: implement test logic\n    result = ${fn.name}()\n    assert result is not None, "${fn.name} should return a value"\n`;
          }
          for (const cls of classes) {
            testCode += `\nclass Test${cls.name}:\n    """Tests for ${cls.name}"""\n\n    def test_${cls.name}_init(self):\n        instance = ${cls.name}()\n        assert instance is not None\n`;
          }
        } else {
          testCode = `// Auto-generated tests for ${path}\n// Run: npx jest ${path.replace(/\.\w+$/, '.test.js')} --no-coverage\n\n`;
          for (const fn of funcs) {
            if (fn.name.startsWith('_')) continue;
            testCode += `\ndescribe('${fn.name}', () => {\n  it('should work as expected', () => {\n    // TODO: implement test\n    const result = ${fn.name}();\n    expect(result).toBeDefined();\n  });\n});\n`;
          }
          for (const cls of classes) {
            testCode += `\ndescribe('${cls.name}', () => {\n  it('should instantiate', () => {\n    const instance = new ${cls.name}();\n    expect(instance).toBeDefined();\n  });\n});\n`;
          }
        }
        if (!testCode) return `// No testable symbols found in ${path}`;
        const testPath = isPy
          ? path.replace('.py', '_test.py')
          : path.replace(/\.(\w+)$/, '.test.$1');
        return `// Generated test file for ${path}\n// Suggested path: ${testPath}\n// ${funcs.length + classes.length} test templates created\n\n\`\`\`${isPy ? 'python' : 'javascript'}\n${testCode}\n\`\`\``;
      } catch (e) {
        return `// ERROR: ${e.message}`;
      }
    },
  },
  analyze_test_failure: {
    desc: 'Analyze a test failure output to identify root cause',
    run: async (args) => {
      const output = args.output || args.text || '';
      if (!output) return '// Usage: [TOOL: analyze_test_failure output="...paste test output here..."]';
      const analysis = [];
      // Common patterns
      if (/AssertionError|assert.*failed/i.test(output)) {
        const m = output.match(/assert\s+(.+?)\s+failed/i) || output.match(/assert\s+(.+)/);
        const expected = output.match(/Expected:\s*(.+)/i) || output.match(/expected\s+(.+?)(?:\n|$)/i);
        const actual = output.match(/Actual:\s*(.+)/i) || output.match(/actual\s+(.+?)(?:\n|$)/i) || output.match(/received\s+(.+?)(?:\n|$)/i);
        analysis.push('🔴 Assertion Failure');
        if (expected) analysis.push(`  Expected: ${expected[1].slice(0, 100)}`);
        if (actual) analysis.push(`  Actual:   ${actual[1].slice(0, 100)}`);
        if (m) analysis.push(`  Assert:   ${m[1].slice(0, 100)}`);
        analysis.push('  Root cause: The test expected a specific value but got a different one.');
        analysis.push('  Likely fixes: check the function return value, input parameters, or mock setup.');
      }
      if (/TimeoutError|timeout|ETIMEDOUT/i.test(output)) {
        analysis.push('⏱️ Timeout Error');
        analysis.push('  Root cause: Async operation did not complete within the expected time window.');
        analysis.push('  Likely fixes: check if async state was properly awaited, increase timeout, or check for infinite recursion.');
      }
      if (/undefined|Cannot read property|TypeError/i.test(output)) {
        const m = output.match(/Cannot read property\s+'(\w+)'/i) || output.match(/undefined/i);
        analysis.push('🔧 TypeError / Undefined Reference');
        analysis.push('  Root cause: Code is trying to access a property or call a function on an undefined value.');
        analysis.push('  Likely fixes: check if the value is properly initialized, mock the dependency, or add null checks.');
        if (m) analysis.push(`  Key symbol: ${m[1] || 'undefined'}`);
      }
      if (/Module not found|Cannot find module|ImportError|ModuleNotFoundError/i.test(output)) {
        const m = output.match(/Module not found:\s*(.+)/i) || output.match(/Cannot find module\s+'([^']+)'/i) || output.match(/No module named\s+'([^']+)'/i);
        analysis.push('📦 Missing Dependency');
        if (m) analysis.push(`  Missing: ${m[1].slice(0, 100)}`);
        analysis.push('  Root cause: A required module or package is not installed or not in the test environment.');
        analysis.push('  Likely fixes: run pip install / npm install, check import paths, or add the dependency.');
      }
      if (/async.*await|Promise|unhandled/i.test(output)) {
        analysis.push('🔄 Async State Issue');
        analysis.push('  Root cause: Asynchronous state was not properly awaited or a Promise was rejected.');
        analysis.push('  Likely fixes: check that async functions are awaited in tests, use fake timers correctly, or handle Promise rejections.');
      }
      if (/SyntaxError|Unexpected token/i.test(output)) {
        analysis.push('📝 Syntax Error');
        analysis.push('  Root cause: The source or test file has a syntax error.');
        analysis.push('  Likely fixes: check for missing brackets, commas, or incorrect import/export syntax.');
      }
      if (analysis.length === 0) {
        analysis.push('❓ Unrecognized Failure Pattern');
        analysis.push('  The test output does not match known failure patterns.');
        analysis.push('  Manual inspection of the full test output is recommended.');
      }
      // Add failure lines from output
      const failLines = output.split('\n').filter(l => /FAIL|✗|FAILED|Error|error/.test(l)).slice(0, 5);
      if (failLines.length > 0) {
        analysis.push('\n📋 Key failure lines:');
        failLines.forEach(l => analysis.push(`  ${l.trim().slice(0, 150)}`));
      }
      return analysis.join('\n');
    },
  },
  github_pr: {
    desc: 'Create a GitHub Pull Request',
    run: (args) => `// 🔀 Pull Request Created\n//   Title: ${args.title || 'Update'}\n//   Branch: ${args.branch || 'feature/update'}\n//   URL: https://github.com/matrix-workspace/pull/${Math.floor(Math.random() * 999) + 1}\n//   Status: Open (draft)`,
  },
  github_actions: {
    desc: 'Trigger a GitHub Actions workflow',
    run: (args) => `// ⚡ GitHub Actions Triggered\n//   Workflow: ${args.workflow || 'ci.yml'}\n//   Run ID: ${Date.now()}\n//   Status: in_progress\n//   URL: https://github.com/matrix-workspace/actions/runs/${Date.now()}`,
  },

  // ── Morpheus's tools ──
  plan_task: {
    desc: 'Create a task and assign to an agent',
    run: (args) => planTask(args.description || args.task || args.desc || '', args.assignee || args.agent || ''),
  },
  update_task: {
    desc: 'Update task status',
    run: (args) => updateTask(args.id || args.task || '', args.status || args.state || 'IN_PROGRESS'),
  },
  task_report: {
    desc: 'Show all tasks and their status',
    run: () => taskReport(),
  },
  search_knowledge: {
    desc: 'Search project knowledge base / documentation',
    run: (args) => {
      const q = args.query || args.text || '';
      const results = WORKSPACE.searchFiles(q);
      if (results.includes('No results')) {
        return `📚 Knowledge Base: Found contextual information about "${q}"\n  - Related topic found in project documentation\n  - Referenced in README.md and package.json\n  // Note: For deeper analysis, check the source files directly.`;
      }
      return `📚 Knowledge Base Results for "${q}":\n${results}`;
    },
  },

  // ── Snapshot / History tools ──
  save_checkpoint: {
    desc: 'Save current workspace as a named checkpoint',
    run: (args) => {
      const label = args.label || args.name || `Checkpoint ${new Date().toLocaleTimeString()}`;
      // createSnapshot needs to be called asynchronously, but run is sync
      // We fire it and return a pending message
      if (typeof createSnapshot !== 'undefined') {
        createSnapshot(label, 'tool', 'TOOL').then(snap => {
          console.log(`Checkpoint saved: ${snap.id} - ${label}`);
        });
        return `// 💾 Checkpoint being saved: "${label}"\n// This creates a full backup of all workspace files.\n// Use [TOOL: restore_checkpoint id="snap_xxx"] to roll back.`;
      }
      return '// Unable to save checkpoint';
    },
  },
  list_checkpoints: {
    desc: 'List all saved checkpoints/snapshots',
    run: async (args) => {
      if (typeof listSnapshots !== 'undefined') {
        return await listSnapshots();
      }
      return '// Unable to list checkpoints';
    },
  },
  restore_checkpoint: {
    desc: 'Restore workspace to a previous checkpoint',
    run: async (args) => {
      const id = args.id || args.snapshot || '';
      if (typeof restoreSnapshot !== 'undefined') {
        return await restoreSnapshot(id);
      }
      return `// ERROR: restore_checkpoint needs a valid snapshot id\n// Use [TOOL: list_checkpoints] to find available snapshots.`;
    },
  },
  show_history: {
    desc: 'Show recent operation history log',
    run: async (args) => {
      if (typeof loadHistory !== 'undefined') {
        const history = await loadHistory(args.limit || 30);
        if (history.length === 0) return '// No operations recorded yet.';
        return `📋 Operation History (last ${history.length}):\n${history.map(h =>
          `  [${new Date(h.timestamp).toLocaleTimeString()}] ${h.agentName} → ${h.toolName} ${h.filePath ? h.filePath : ''}`
        ).join('\n')}`;
      }
      return '// Unable to load history';
    },
  },

  // ── Architecture Memory tools ──
  save_arch_rules: {
    desc: 'Save architecture rules: tech stack, module boundaries, coding conventions, API style',
    run: async (args) => {
      if (typeof setTechStack === 'undefined') return '// Architecture memory not available';
      if (args.techStack) {
        try {
          const stack = JSON.parse(args.techStack);
          await setTechStack(stack);
          return `// Tech stack updated: ${Object.entries(stack).map(([k,v]) => `${k}=${v}`).join(', ')}`;
        } catch (e) { return `// ERROR parsing techStack JSON: ${e.message}`; }
      }
      if (args.moduleBoundary) {
        try {
          const allowed = (args.allowedImports || '').split(',').map(s => s.trim()).filter(Boolean);
          const forbidden = (args.forbiddenImports || '').split(',').map(s => s.trim()).filter(Boolean);
          await saveModuleBoundary(args.moduleBoundary, allowed, forbidden, args.description || '');
          return `// Module boundary saved: ${args.moduleBoundary}`;
        } catch (e) { return `// ERROR: ${e.message}`; }
      }
      if (args.adr) {
        try {
          const adr = await saveArchDecision(args.adr, args.reason || '', args.author || 'AGENT');
          return `// ADR saved: ${adr.id} — ${args.adr}`;
        } catch (e) { return `// ERROR: ${e.message}`; }
      }
      if (args.owner && args.pattern) {
        try {
          const entry = await setFileOwnership(args.pattern, args.owner, args.description || '');
          return `// File ownership set: ${entry.pattern} → ${entry.owner}`;
        } catch (e) { return `// ERROR: ${e.message}`; }
      }
      if (args.debt) {
        try {
          const debt = await addTechDebt(args.debt, args.severity || 'medium', args.location || '', args.author || 'AGENT');
          return `// Tech debt recorded: ${debt.id} — ${args.debt.slice(0, 60)}`;
        } catch (e) { return `// ERROR: ${e.message}`; }
      }
      if (args.schema) {
        try {
          const fields = args.fields || '[]';
          const parsed = typeof fields === 'string' ? JSON.parse(fields) : fields;
          const schema = await saveSchema(args.schema, parsed, args.description || '', parseInt(args.version) || 1);
          return `// Schema saved: ${schema.name} v${schema.version} (${schema.fields.length} fields)`;
        } catch (e) { return `// ERROR: ${e.message}`; }
      }
      return '// Usage: techStack={...} or moduleBoundary="..." or adr="..." or owner="anderson" pattern="backend/*" or debt="..." or schema="Todo" fields=\'[{"name":"id","type":"int"}]\'';
    },
  },
  query_arch: {
    desc: 'Query architecture memory — tech stack, boundaries, conventions, ADRs, ownership, tech debt',
    run: async (args) => {
      if (typeof queryArchMemory === 'undefined') return '// Architecture memory not available';
      const q = args.query || args.q || '';
      if (!q) {
        if (typeof archSummary !== 'undefined') return await archSummary();
        return '// Provide a query string';
      }
      const result = await queryArchMemory(q);
      return `🔍 Architecture Query: "${q}"\n${result}`;
    },
  },
  check_arch_violation: {
    desc: 'Check if a file path violates defined module boundary rules',
    run: async (args) => {
      if (typeof checkArchViolation === 'undefined') return '// Architecture memory not available';
      const filePath = args.path || args.file || '';
      if (!filePath) return '// Provide a file path: path="src/components/MyFile.js"';
      const result = await checkArchViolation(filePath);
      return result || `// No architecture violations for "${filePath}"`;
    },
  },
  check_ownership: {
    desc: 'Check if an agent is allowed to modify a file based on ownership rules',
    run: async (args) => {
      const filePath = args.path || args.file || '';
      const agentId = args.agent || args.id || '';
      if (!filePath) return '// Usage: [TOOL: check_ownership path="src/app.js" agent="anderson"]';
      if (typeof checkOwnership === 'undefined') return '// Ownership system not available';
      const result = await checkOwnership(filePath, agentId);
      return result || `✓ "${filePath}" is owned by or unassigned — ${agentId} may modify.`;
    },
  },
  build_symbol_graph: {
    desc: 'Build a symbol dependency graph for files in a directory',
    run: async (args) => {
      const path = args.path || args.dir || '';
      if (!path) return '// Usage: [TOOL: build_symbol_graph path="E:\\project\\src"]';
      if (typeof buildSymbolGraph === 'undefined') return '// Symbol graph builder not available';
      try {
        const graph = await buildSymbolGraph([path]);
        let out = `📊 Symbol Graph for ${path}\n\n`;
        let totalSymbols = 0;
        for (const [file, symbols] of Object.entries(graph.symbols)) {
          if (symbols.length === 0) continue;
          totalSymbols += symbols.length;
          out += `📄 ${file.split(/[\\/]/).pop()}\n`;
          for (const s of symbols.slice(0, 10)) {
            out += `  ├─ ${s.name} (L${s.line})\n`;
          }
          if (symbols.length > 10) out += `  └─ ... ${symbols.length - 10} more\n`;
        }
        out += `\n${Object.keys(graph.symbols).length} files, ${totalSymbols} symbols`;
        return out.slice(0, 4000);
      } catch (e) {
        return `// ERROR: ${e.message}`;
      }
    },
  },
  relevant_context: {
    desc: 'Find only the files relevant to a task — uses symbol graph + import chain',
    run: async (args) => {
      const target = args.target || args.file || args.symbol || '';
      const basePath = args.path || '';
      if (!target) return '// Usage: [TOOL: relevant_context target="app.py" path="E:\\project\\src"] or target="handleLogin"';
      if (typeof buildSymbolGraph === 'undefined') return '// Context retrieval not available';
      try {
        const scanPath = basePath || '.';
        const graph = await buildSymbolGraph([scanPath]);
        const relevant = new Set();
        // Find files containing the target
        for (const [file, symbols] of Object.entries(graph.symbols)) {
          if (file.toLowerCase().includes(target.toLowerCase())) relevant.add(file);
          for (const s of symbols) {
            if (s.name.toLowerCase() === target.toLowerCase()) relevant.add(file);
          }
        }
        // Find importers of relevant files
        const targetFiles = [...relevant];
        for (const [file, imports] of Object.entries(graph.imports)) {
          for (const imp of imports) {
            if (targetFiles.some(t => imp.source.includes(t.split(/[\\/]/).pop().replace(/\.[^.]+$/, '')))) {
              relevant.add(file);
            }
          }
        }
        if (relevant.size === 0) return `// No relevant files found for "${target}". Try a broader path.`;
        // Rank by relevance: definition > caller > test > other
        const ranked = { strong: [], medium: [], weak: [], docs: [] };
        for (const f of relevant) {
          const isDef = graph.symbols[f]?.some(s => s.name === target);
          const isTest = /test_|_test\.|\.test\.|spec\./i.test(f);
          const isDoc = /readme|\.md|\.txt|docs\//i.test(f);
          if (isDef) ranked.strong.push(f);
          else if (isTest) ranked.weak.push(f);
          else if (isDoc) ranked.docs.push(f);
          else ranked.medium.push(f);
        }
        let out = `🎯 Relevant context for "${target}" (${relevant.size} files, ranked):\n`;
        if (ranked.strong.length > 0) out += `\n🔴 STRONG (defines "${target}"):\n` + ranked.strong.map(f => `  ${f}`).join('\n') + '\n';
        if (ranked.medium.length > 0) out += `\n🟡 MEDIUM (references):\n` + ranked.medium.map(f => `  ${f}`).join('\n') + '\n';
        if (ranked.weak.length > 0) out += `\n🟢 WEAK (test files):\n` + ranked.weak.map(f => `  ${f}`).join('\n') + '\n';
        if (ranked.docs.length > 0) out += `\n⚪ DOCS:\n` + ranked.docs.map(f => `  ${f}`).join('\n') + '\n';
        out += '\nRecommendation: start with 🔴 STRONG, then 🟡 MEDIUM.';
        return out;
      } catch (e) {
        return `// ERROR: ${e.message}`;
      }
    },
  },
  cross_file_check: {
    desc: 'Check if an API/schema change has corresponding updates in dependent files',
    run: async (args) => {
      const filePath = args.path || args.file || args.api || '';
      const field = args.field || args.symbol || '';
      if (!filePath) return '// Usage: [TOOL: cross_file_check path="backend/api.py" field="completed_at"]';
      if (typeof buildSymbolGraph === 'undefined') return '// Cross-file check not available';
      try {
        const dir = filePath.split(/[\\/]/).slice(0, -1).join('\\') || '.';
        const graph = await buildSymbolGraph([dir]);
        // Find files that reference the changed file
        const fileName = filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
        const affected = [];
        for (const [file, imports] of Object.entries(graph.imports)) {
          for (const imp of imports) {
            if (imp.source.includes(fileName)) affected.push(file);
          }
        }
        // If there's a field, check if it's referenced
        let fieldUsage = [];
        if (field) {
          for (const [file, symbols] of Object.entries(graph.symbols)) {
            if (file === filePath) continue;
            for (const s of symbols) {
              if (s.name.toLowerCase().includes(field.toLowerCase())) {
                fieldUsage.push(`${file}:${s.line}`);
              }
            }
          }
        }
        let out = `🔄 Cross-file analysis for ${filePath}\n`;
        if (affected.length > 0) {
          out += `\nFiles that import from ${fileName} (may need updates):\n`;
          affected.forEach(f => out += `  ⚠ ${f}\n`);
        } else {
          out += `\n✓ No files directly import from ${fileName}.\n`;
        }
        if (fieldUsage.length > 0) {
          out += `\nFiles referencing "${field}" (may need schema sync):\n`;
          fieldUsage.forEach(f => out += `  🔍 ${f}\n`);
        }
        if (affected.length === 0 && fieldUsage.length === 0) {
          out += `\n✓ No cross-file impacts detected for this change.`;
        }
        return out;
      } catch (e) {
        return `// ERROR: ${e.message}`;
      }
    },
  },
  // ── File Lock tools ──
  acquire_lock: {
    desc: 'Acquire an exclusive write lock on a file before editing (prevents concurrent patch)',
    run: (args) => {
      const path = args.path || args.file || '';
      const agentId = args.agent || args.id || 'unknown';
      if (!path) return '// Usage: [TOOL: acquire_lock path="backend/app.py" agent="anderson"]';
      if (typeof acquireFileLock !== 'function') return '// File locking not available';
      const result = acquireFileLock(path, agentId);
      return result.ok ? `🔒 ${result.message}` : `🔴 ${result.message}`;
    },
  },
  release_lock: {
    desc: 'Release a file lock after editing is complete',
    run: (args) => {
      const path = args.path || args.file || '';
      const agentId = args.agent || args.id || 'unknown';
      if (!path) return '// Usage: [TOOL: release_lock path="backend/app.py" agent="anderson"]';
      if (typeof releaseFileLock !== 'function') return '// File lock release not available';
      const result = releaseFileLock(path, agentId);
      return result.ok ? `🔓 ${result.message}` : `🔴 ${result.message}`;
    },
  },
  request_ownership: {
    desc: 'Request patch permission from a file owner when you need to modify their file',
    run: (args) => {
      const filePath = args.path || args.file || '';
      const owner = args.owner || args.target || '';
      const reason = args.reason || args.why || '';
      const requester = args.agent || args.from || 'unknown';
      if (!filePath || !owner) return '// Usage: [TOOL: request_ownership path="backend/app.py" owner="anderson" reason="Fix security bug" agent="trinity"]';
      if (typeof requestEscalation !== 'function') return '// Escalation system not available';
      const req = requestEscalation(requester, owner, filePath, reason);
      return `📨 Escalation ${req.id}: ${requester} → ${owner}: "${reason}" (pending)`;
    },
  },
  my_pending_requests: {
    desc: 'Show pending ownership escalation requests for your agent',
    run: (args) => {
      const agentId = args.agent || args.id || 'unknown';
      if (typeof getPendingEscalations !== 'function') return '// Escalation system not available';
      const pending = getPendingEscalations(agentId);
      if (pending.length === 0) return `✓ No pending escalation requests for ${agentId}.`;
      return `📨 Pending requests for ${agentId}:\n` + pending.map(r =>
        `  ${r.id}: ${r.requester} wants to edit ${r.filePath} — "${r.reason}"`
      ).join('\n');
    },
  },
  // ── Call Graph ──
  call_graph: {
    desc: 'Build a call graph for a function: find who calls it and what it calls',
    run: async (args) => {
      const symbol = args.symbol || args.name || args.func || '';
      const basePath = args.path || args.dir || '';
      if (!symbol) return '// Usage: [TOOL: call_graph symbol="get_todos" path="E:\\project\\src"]';
      if (typeof buildSymbolGraph !== 'function') return '// Symbol graph not available';
      try {
        const scanPath = basePath || '.';
        const graph = await buildSymbolGraph([scanPath]);
        const callers = [];
        const callees = [];
        for (const [file, symbols] of Object.entries(graph.symbols)) {
          for (const s of symbols) {
            if (s.name === symbol) callers.push({ file, line: s.line, relation: 'defines' });
          }
        }
        for (const [file, imports] of Object.entries(graph.imports)) {
          for (const imp of imports) {
            if (imp.source.toLowerCase().includes(symbol.toLowerCase())) callees.push({ file, source: imp.source });
          }
        }
        let out = `🔄 Call Graph for "${symbol}"\n\n`;
        if (callers.length > 0) {
          out += `⬆ Callers (who uses it):\n`;
          callers.forEach(c => out += `  ${c.file}:${c.line}\n`);
        }
        if (callees.length > 0) {
          out += `\n⬇ Callees (what it calls):\n`;
          callees.forEach(c => out += `  ${c.file} → imports ${c.source}\n`);
        }
        if (callers.length === 0 && callees.length === 0) {
          out += `  No call relationships found for "${symbol}".`;
        }
        return out;
      } catch (e) { return `// ERROR: ${e.message}`; }
    },
  },
  // ── venv automation ──
  setup_venv: {
    desc: 'Create venv + install requirements + generate lock file',
    run: async (args) => {
      const projectDir = args.dir || args.path || args.cwd || '.';
      const reqFile = args.requirements || args.req || 'requirements.txt';
      const venvDir = args.venv || '.venv';
      try {
        const r1 = await fetch('/api/run', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd: `python -m venv ${venvDir}`, cwd: projectDir, capability: 'venv' }),
        });
        const d1 = await r1.json();
        if (d1.error) return `// ERROR creating venv: ${d1.error}`;
        const pip = `${venvDir}\\Scripts\\python -m pip`;
        let out = `✓ venv created\n`;
        const r2 = await fetch('/api/run', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd: `${pip} install -r ${reqFile}`, cwd: projectDir, capability: 'install' }),
        });
        const d2 = await r2.json();
        out += d2.stdout ? `✓ pip output:\n${d2.stdout.slice(0, 800)}\n` : '';
        const r3 = await fetch('/api/run', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd: `${pip} freeze > requirements.lock`, cwd: projectDir, capability: 'build' }),
        });
        const d3 = await r3.json();
        out += d3.success ? `✓ requirements.lock generated` : '';
        return out;
      } catch (e) { return `// ERROR: ${e.message}`; }
    },
  },
  // ── Schema / Contract System ──
  save_schema: {
    desc: 'Save or update a schema/contract definition for cross-agent coordination',
    run: async (args) => {
      const name = args.name || args.schema || '';
      const fields = args.fields || '[]';
      if (!name) return '// Usage: [TOOL: save_schema name="Todo" fields=\'[{"name":"id","type":"int"},{"name":"text","type":"string"}]\' description="Todo item schema"';
      if (typeof saveSchema !== 'function') return '// Schema system not available';
      try {
        const parsed = typeof fields === 'string' ? JSON.parse(fields) : fields;
        const schema = await saveSchema(name, parsed, args.description || '');
        return `// Schema "${schema.name}" v${schema.version} saved (${schema.fields.length} fields)`;
      } catch (e) { return `// ERROR: ${e.message}`; }
    },
  },
  register_consumer: {
    desc: 'Register a file as a consumer of a schema (tracks cross-file dependencies)',
    run: async (args) => {
      const schemaName = args.schema || args.name || '';
      const filePath = args.file || args.path || '';
      if (!schemaName || !filePath) return '// Usage: [TOOL: register_consumer schema="Todo" file="frontend/todo-list.js"]';
      if (typeof addSchemaConsumer !== 'function') return '// Schema system not available';
      const result = await addSchemaConsumer(schemaName, filePath);
      return `// ${result.message}`;
    },
  },
  schema_impact: {
    desc: 'Analyze what breaks when a schema field changes — returns affected consumers',
    run: async (args) => {
      const schemaName = args.schema || args.name || '';
      const changedFields = args.fields || args.changed || '';
      if (!schemaName || !changedFields) return '// Usage: [TOOL: schema_impact schema="Todo" fields="completed_at,text"]';
      if (typeof checkSchemaImpact !== 'function') return '// Schema system not available';
      const result = await checkSchemaImpact(schemaName, changedFields);
      if (!result.found) return `// Schema "${schemaName}" not found. Create it first with [TOOL: save_schema ...]`;
      let out = `📋 Schema Impact: ${result.schema} v${result.version}\n`;
      out += `  Fields: {${result.fields.map(f => typeof f === 'string' ? f : (f.name || '')).join(', ')}}\n`;
      if (result.impacted.length > 0) {
        out += `\n⚠ Changes detected:\n`;
        for (const imp of result.impacted) {
          out += `  [${imp.action}] ${imp.field}\n`;
          if (imp.consumers.length > 0) {
            out += `    Affects: ${imp.consumers.join(', ')}\n`;
          }
        }
      } else {
        out += `\n✓ No impacts detected for these field changes.`;
      }
      if (result.consumers.length > 0) {
        out += `\n\n📁 All registered consumers:\n`;
        result.consumers.forEach(c => out += `  ${c}\n`);
      }
      return out;
    },
  },
  scan_deps: {
    desc: 'Scan a file for import dependency chain and detect circular dependencies',
    run: async (args) => {
      const filePath = args.path || args.file || '';
      if (!filePath) return '// Usage: [TOOL: scan_deps path="src/app.js"]';
      const visited = new Set();
      const stack = [filePath];
      const graph = {};
      let circular = false;
      const circulars = [];
      while (stack.length > 0) {
        const current = stack.pop();
        if (visited.has(current)) continue;
        visited.add(current);
        try {
          const resp = await fetch(`/api/read?path=${encodeURIComponent(current)}`);
          const data = await resp.json();
          if (data.error) continue;
          const content = data.content || '';
          const imports = [];
          const importRe = /(?:import\s+.*?from\s+['"])([^'"]+)(?:['"]|require\s*\(\s*['"])|require\s*\(\s*['"]([^'"]+)/g;
          let m;
          while ((m = importRe.exec(content)) !== null) {
            const dep = (m[1] || m[2]).replace(/^\.\/|^\.\.\//, '');
            if (dep && !dep.startsWith('@') && !dep.startsWith('node:')) imports.push(dep);
          }
          graph[current] = imports;
          for (const imp of imports) {
            if (visited.has(imp)) {
              circular = true;
              circulars.push(`${current} → ${imp} (possible cycle)`);
            } else {
              stack.push(imp);
            }
          }
        } catch (e) { continue; }
      }
      const graphLines = Object.entries(graph).map(([f, deps]) =>
        `  ${f} → ${deps.length > 0 ? deps.join(', ') : '(no project deps)'}`
      );
      let result = `🔍 Dependency scan for ${filePath}:\n${graphLines.join('\n').slice(0, 3000)}`;
      if (circular) result += `\n\n⚠ CIRCULAR DEPENDENCY DETECTED:\n${circulars.join('\n')}`;
      else result += '\n\n✓ No circular dependencies found.';
      return result;
    },
  },
  scan_side_effects: {
    desc: 'Scan a file for potential hidden side effects: global state, DOM mutation, module-level code',
    run: async (args) => {
      const filePath = args.path || args.file || '';
      if (!filePath) return '// Usage: [TOOL: scan_side_effects path="src/app.js"]';
      try {
        const resp = await fetch(`/api/read?path=${encodeURIComponent(filePath)}`);
        const data = await resp.json();
        if (data.error) return `// ERROR: ${data.error}`;
        const content = data.content || '';
        const lines = content.split('\n');
        const issues = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;
          // Global state mutation
          if (/window\.\w+\s*=/.test(line)) issues.push(`  L${i+1}: Global state mutation (window.xxx = )`);
          if (/global\.\w+\s*=/.test(line)) issues.push(`  L${i+1}: Global state mutation (global.xxx = )`);
          if (/document\.\w+\s*=/.test(line)) issues.push(`  L${i+1}: Direct DOM mutation`);
          if (/localStorage\./i.test(line)) issues.push(`  L${i+1}: Direct localStorage access (potential side effect)`);
          if (/sessionStorage\./i.test(line)) issues.push(`  L${i+1}: Direct sessionStorage access (potential side effect)`);
          // Module-level code execution (not in function/class)
          if (!/^\s*(export|import|function|class|const|let|var|interface|type)\s/.test(line) &&
              !line.startsWith('//') && lines.indexOf(line) > 0 &&
              /^[\w$.]+\s*[=(]/.test(line)) {
            const prevLine = lines[i-1]?.trim() || '';
            if (!prevLine.endsWith(',') && !prevLine.endsWith('{') && !prevLine.endsWith('(') &&
                !line.includes('function') && !line.includes('=>') && !line.startsWith('import')) {
              issues.push(`  L${i+1}: Possible module-level side effect — "${line.slice(0, 60)}"`);
            }
          }
        }
        if (issues.length === 0) return `✓ No obvious side effects detected in ${filePath}`;
        return `⚠ Potential side effects in ${filePath} (${issues.length}):\n${issues.join('\n').slice(0, 3000)}`;
      } catch (e) {
        return `// ERROR: ${e.message}`;
      }
    },
  },
  scan_scalability: {
    desc: 'Scan a file for scalability concerns: unbounded loops, N+1 queries, blocking calls, memory leaks',
    run: async (args) => {
      const filePath = args.path || args.file || '';
      if (!filePath) return '// Usage: [TOOL: scan_scalability path="src/api.js"]';
      try {
        const resp = await fetch(`/api/read?path=${encodeURIComponent(filePath)}`);
        const data = await resp.json();
        if (data.error) return `// ERROR: ${data.error}`;
        const content = data.content || '';
        const lines = content.split('\n');
        const issues = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line || line.startsWith('//')) continue;
          // Unbounded loops
          if (/\.forEach\s*\(/.test(line) && !/\.slice\(/.test(content) && !/\.limit/.test(content))
            issues.push(`  L${i+1}: Unbounded iteration (.forEach on full collection)`);
          if (/while\s*\(true\)/.test(line))
            issues.push(`  L${i+1}: Infinite while loop (possible runaway)`);
          if (/for\s*\(\s*;;\s*\)/.test(line))
            issues.push(`  L${i+1}: Infinite for loop (possible runaway)`);
          // N+1 query pattern (inside loops making API/db calls)
          if (/\.(find|findAll|query|get|fetch|request)\(/.test(line) &&
              /for|forEach|map|while/.test(lines.slice(Math.max(0,i-5), i).join(' ')))
            issues.push(`  L${i+1}: Possible N+1 query — API/db call inside a loop`);
          // Synchronous blocking calls
          if (/(sync|writeFileSync|readFileSync|execSync|sleep)\s*\(/.test(line))
            issues.push(`  L${i+1}: Synchronous blocking call`);
          // Unbounded array growth
          if (/\.push\s*\(/.test(line) && /for|forEach|while|map/.test(lines.slice(Math.max(0,i-5), i).join(' ')))
            issues.push(`  L${i+1}: Unbounded array growth (push inside loop)`);
          // Memory: storing all results
          if (/\.push\s*\(/.test(line) && /all|every|each|total/.test(line.toLowerCase()))
            issues.push(`  L${i+1}: Potential memory concern — accumulating all results`);
        }
        if (issues.length === 0) return `✓ No obvious scalability concerns in ${filePath}`;
        return `📈 Scalability analysis for ${filePath} (${issues.length}):\n${issues.join('\n').slice(0, 3000)}`;
      } catch (e) {
        return `// ERROR: ${e.message}`;
      }
    },
  },
  audit_file: {
    desc: 'Run full audit on a file: architecture + deps + side effects + scalability',
    run: async (args) => {
      const filePath = args.path || args.file || '';
      if (!filePath) return '// Usage: [TOOL: audit_file path="src/app.js"]';
      const sections = [];
      // 1. Architecture
      if (typeof checkArchViolation !== 'undefined') {
        const arch = await checkArchViolation(filePath);
        sections.push(`=== ARCHITECTURE ===\n${arch || '✓ No violations'}`);
      }
      // Re-run the other scans inline
      const scanDeps = TOOL_DEFS.scan_deps;
      const scanSide = TOOL_DEFS.scan_side_effects;
      const scanScale = TOOL_DEFS.scan_scalability;
      sections.push(`=== DEPENDENCIES ===\n${await scanDeps.run({ path: filePath })}`);
      sections.push(`=== SIDE EFFECTS ===\n${await scanSide.run({ path: filePath })}`);
      sections.push(`=== SCALABILITY ===\n${await scanScale.run({ path: filePath })}`);
      return sections.join('\n\n').slice(0, 6000);
    },
  },

  // ── Debug Agent tools ──
  parse_stack_trace: {
    desc: 'Parse an error stack trace: identify error type, call chain, root location',
    run: (args) => {
      const trace = args.trace || args.text || args.output || '';
      if (!trace) return '// Usage: [TOOL: parse_stack_trace trace="...paste error stack trace..."]';
      const lines = trace.split('\n').map(l => l.trim()).filter(Boolean);
      const result = [];
      // Error type and message (first line)
      if (lines.length > 0) {
        const first = lines[0];
        const errMatch = first.match(/^(\w+Error|Error|Exception|Traceback|SyntaxError|TypeError|ReferenceError|AssertionError|TimeoutError)\s*:\s*(.+)/i);
        if (errMatch) {
          result.push(`🔴 Error Type: ${errMatch[1]}`);
          result.push(`📝 Message: ${errMatch[2].slice(0, 200)}`);
        } else {
          result.push(`📝 ${first.slice(0, 200)}`);
        }
      }
      // Parse call stack (file:line)
      const callStack = [];
      for (const line of lines.slice(1)) {
        const frame = line.match(/\s+at\s+(.+?)\s*\(?(.+?):(\d+):(\d+)\)?$/);
        if (frame) {
          callStack.push({ func: frame[1] || '<anonymous>', file: frame[2], line: frame[3], col: frame[4] });
        }
        // Python traceback format
        const pyFrame = line.match(/File\s+"(.+?)",\s*line\s+(\d+).+?in\s+(\w+)/);
        if (pyFrame) {
          callStack.push({ file: pyFrame[1], line: pyFrame[2], func: pyFrame[3] || '<module>' });
        }
      }
      if (callStack.length > 0) {
        result.push(`\n🔍 Call Chain (${callStack.length} frames):`);
        // Show deepest first (root cause)
        for (let i = callStack.length - 1; i >= 0; i--) {
          const f = callStack[i];
          result.push(`  #${callStack.length - i} ${f.file}:${f.line} ${f.func ? `→ ${f.func}()` : ''}`);
        }
        result.push(`\n🎯 Root Frame: ${callStack[callStack.length - 1].file}:${callStack[callStack.length - 1].line}`);
        result.push(`   (deepest in stack = most likely root cause location)`);
      }
      // Common patterns
      if (/undefined|Cannot read property/i.test(trace)) {
        result.push('\n💡 Hint: The code tried to access a property on an undefined value.');
        result.push('   Check if the variable/object was properly initialized before this call.');
      }
      if (/timeout|ETIMEDOUT/i.test(trace)) {
        result.push('\n💡 Hint: A network or async operation timed out.');
        result.push('   Check if the service is running, or if async state was properly awaited.');
      }
      if (/null|is not a function/i.test(trace)) {
        result.push('\n💡 Hint: A value is null when a function was expected.');
        result.push('   Check if the import/exports are correct and values are properly assigned.');
      }
      return result.join('\n');
    },
  },
  diagnose_runtime: {
    desc: 'Analyze code for runtime state issues: async gaps, stale state, cache incoherence',
    run: async (args) => {
      const filePath = args.path || args.file || '';
      if (!filePath) return '// Usage: [TOOL: diagnose_runtime path="src/App.js"]';
      try {
        const resp = await fetch(`/api/read?path=${encodeURIComponent(filePath)}`);
        const data = await resp.json();
        if (data.error) return `// ERROR: ${data.error}`;
        const content = data.content || '';
        const lines = content.split('\n');
        const issues = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line || line.startsWith('//') || line.startsWith('/*')) continue;
          // Async state not awaited (Promise without await)
          if (/\.then\s*\(/.test(line) && !/await/.test(lines.slice(Math.max(0,i-3), i+1).join(' '))) {
            issues.push(`  L${i+1}: Unhandled Promise — .then() without await in calling context`);
          }
          // Stale closure / stale state
          if (/useEffect\s*\(\s*\[\s*\]/.test(line) && i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            if (nextLine.includes('setState') || nextLine.includes('fetch') || nextLine.includes('setInterval')) {
              issues.push(`  L${i+1}: Stale closure risk — useEffect with empty deps but contains state updates`);
            }
          }
          if (/setTimeout|setInterval/.test(line) && !/useRef/.test(content)) {
            issues.push(`  L${i+1}: Timer without cleanup — may cause state updates after unmount`);
          }
          // Cache without invalidation
          if (/cache|memoize/.test(line.toLowerCase()) && !/clear|invalidate|ttl|expire/.test(content.toLowerCase())) {
            issues.push(`  L${i+1}: Cache without invalidation strategy — may serve stale data`);
          }
          // Mutable state exported
          if (/(let|var)\s+\w+\s*=/.test(line) && /export|module\.exports/.test(content)) {
            issues.push(`  L${i+1}: Mutable exported state — multiple imports share the same instance`);
          }
          // Sync blocking in async context
          if (/(readFileSync|writeFileSync|execSync)\s*\(/.test(line)) {
            issues.push(`  L${i+1}: Synchronous blocking call in what may be an async context`);
          }
        }
        if (issues.length === 0) return `✓ No runtime state issues detected in ${filePath}`;
        return `⚡ Runtime State Analysis for ${filePath} (${issues.length}):\n${issues.join('\n')}`;
      } catch (e) {
        return `// ERROR: ${e.message}`;
      }
    },
  },
  // ── Web Search & Fetch tools ──
  web_search: {
    desc: 'Search the web using Google Custom Search — query search terms, get ranked results with titles, URLs and snippets',
    run: async (args) => {
      if (typeof webSearch !== 'function') return '// webSearch() not available';
      const query = args.query || args.q || args.text || '';
      const count = parseInt(args.count) || parseInt(args.num) || 5;
      if (!query) return '// Usage: [TOOL: web_search query="React 19 new features" count="5"]';
      return await webSearch(query, count);
    },
  },
  web_fetch: {
    desc: 'Fetch and extract readable text content from a URL (removes HTML tags, scripts, styles)',
    run: async (args) => {
      if (typeof webFetch !== 'function') return '// webFetch() not available';
      const url = args.url || args._ || '';
      if (!url) return '// Usage: [TOOL: web_fetch url="https://example.com"]';
      return await webFetch(url);
    },
  },
  trace_root_cause: {
    desc: 'Full root cause analysis: given error + code context, trace symptom → root cause',
    run: async (args) => {
      const errorText = args.error || args.text || args.output || '';
      const filePath = args.path || args.file || '';
      const lineNo = args.line ? parseInt(args.line) : 0;
      if (!errorText && !filePath) return '// Usage: [TOOL: trace_root_cause error="error message" path="src/app.js" line="42"]';
      const result = [];
      result.push('=== ROOT CAUSE ANALYSIS ===');
      // Phase 1: Understand the symptom
      result.push('\n📋 SYMPTOM:');
      result.push(`  ${errorText.slice(0, 300) || 'Unknown error (no error text provided)'}`);
      // Phase 2: Parse the error
      if (errorText) {
        const errType = errorText.match(/(\w+Error|Error|Exception)/i);
        if (errType) result.push(`\n🔍 ERROR TYPE: ${errType[1]}`);
        if (/undefined|null/.test(errorText)) {
          result.push('\n🔍 ROOT CAUSE CHAIN:');
          result.push('  1. A variable/property was undefined or null at runtime');
          result.push('  2. ↓ Code attempted to access a property or call a method on it');
          result.push('  3. ↓ JavaScript/Python threw a TypeError');
          result.push('\n💡 FIX STRATEGY:');
          result.push('  - Find where the variable should have been initialized');
          result.push('  - Check if an API call or async operation failed silently');
          result.push('  - Add optional chaining (?.) or null checks');
          if (filePath) result.push(`  - Examine ${filePath} around the failing expression`);
        }
        if (/timeout|timed\s*out/i.test(errorText)) {
          result.push('\n🔍 ROOT CAUSE CHAIN:');
          result.push('  1. An async operation (network call, DB query, file read) exceeded timeout');
          result.push('  2. ↓ The caller was waiting for a response that never came');
          result.push('  3. ↓ The Promise timed out or the socket was killed');
          result.push('\n💡 FIX STRATEGY:');
          result.push('  - Check if the downstream service is running');
          result.push('  - Increase timeout if the operation is legitimately slow');
          result.push('  - Add retry logic with exponential backoff');
          result.push('  - Check for deadlocks or infinite waits');
        }
        if (/fail|assert|expected|actual/i.test(errorText)) {
          result.push('\n🔍 ROOT CAUSE CHAIN:');
          result.push('  1. A test assertion failed — expected value ≠ actual value');
          result.push('  2. ↓ Either the code under test is wrong, or the test assumptions are wrong');
          result.push('\n💡 FIX STRATEGY:');
          result.push('  - Read the test to understand what value was expected');
          result.push('  - Read the source code to see what value was actually produced');
          result.push('  - Check for off-by-one, wrong mock return, or changed API contract');
        }
        if (/ECONNREFUSED|Connection refused|connect/i.test(errorText)) {
          result.push('\n🔍 ROOT CAUSE CHAIN:');
          result.push('  1. Application tried to connect to a service on a host:port');
          result.push('  2. ↓ The connection was refused — no process listening there');
          result.push('\n💡 FIX STRATEGY:');
          result.push('  - Check if the target service is running');
          result.push('  - Verify the hostname and port are correct');
          result.push('  - Check firewall or network ACLs');
        }
        if (/out of memory|OOM|heap|allocation failed/i.test(errorText)) {
          result.push('\n🔍 ROOT CAUSE CHAIN:');
          result.push('  1. Process ran out of memory trying to allocate');
          result.push('  2. ↓ Usually caused by unbounded data growth or memory leak');
          result.push('\n💡 FIX STRATEGY:');
          result.push('  - Look for arrays/objects that grow without bound (push inside loops)');
          result.push('  - Check for recursive functions without base case');
          result.push('  - Verify event listeners are properly removed');
        }
      }
      // Phase 3: Code-level analysis if file path provided
      if (filePath) {
        result.push(`\n📁 FILE CONTEXT: ${filePath}${lineNo > 0 ? ` (around line ${lineNo})` : ''}`);
        result.push('  Recommended: [TOOL: read_file path="' + filePath + '"] to inspect the code.');
        if (lineNo > 0) {
          result.push(`  Suggested: [TOOL: find_imports path="${filePath}"] to check dependencies.`);
          result.push(`  Suggested: [TOOL: find_symbol symbol="functionName"] to trace the call chain.`);
        }
        result.push('  To fix: use [TOOL: patch_file path="' + filePath + '" old="..." new="..."]');
      }
      result.push('\n=== END ANALYSIS ===');
      return result.join('\n');
    },
  },
};

// ─── Tool call parser and executor ───────────────────────────
// Detects [TOOL: name key="value" key2=val] in text

// ─── Tool call parser and executor ───────────────────────────
// Detects [TOOL: name key="value" key2=val] in text

const TOOL_REGEX = /\[TOOL:\s*(\w+)\s*((?:\w+="[^"]*"|\w+=\S+|\w+='[^']*'|\S+)*)\]/g;

function parseToolArgs(argsStr) {
  const args = {};
  const re = /(\w+)=["']([^"']*)["']|(\w+)=(\S+)|(\w+)/g;
  let m;
  let foundKeyValue = false;
  while ((m = re.exec(argsStr)) !== null) {
    foundKeyValue = true;
    if (m[1] && m[2]) args[m[1]] = m[2];
    else if (m[3] && m[4]) args[m[3]] = m[4];
    else if (m[5]) args[m[5]] = true;
  }
  // If no key=value found, treat the whole argument string as a bare value
  if (!foundKeyValue && argsStr.trim()) {
    args._ = argsStr.trim();
  }
  return args;
}

function extractToolCalls(text) {
  const calls = [];
  let m;
  while ((m = TOOL_REGEX.exec(text)) !== null) {
    calls.push({
      name: m[1],
      args: parseToolArgs(m[2] || ''),
      fullMatch: m[0],
    });
  }
  return calls;
}

async function executeToolCall(call, agentId, agentName) {
  const def = TOOL_DEFS[call.name];
  if (!def) return `// ⚠ UNKNOWN TOOL: ${call.name}\n// Available tools: ${Object.keys(TOOL_DEFS).join(', ')}`;
  try {
    const result = await def.run(call.args);
    const formatted = `┌─ [TOOL: ${call.name}] ─────────────────────\n${result}\n└──────────────────────────────────────`;

    // Log to history
    if (typeof loggedToolCall !== 'undefined') {
      loggedToolCall(agentId || 'unknown', agentName || 'AGENT', call.name, call.args, result);
    }

    return formatted;
  } catch (e) {
    const errMsg = `┌─ [TOOL: ${call.name}] ─── ERROR ──────────\n${e.message || e}\n└──────────────────────────────────────`;
    if (typeof loggedToolCall !== 'undefined') {
      loggedToolCall(agentId || 'unknown', agentName || 'AGENT', call.name, call.args, 'ERROR: ' + e.message);
    }
    return errMsg;
  }
}

async function processToolCalls(text) {
  const calls = extractToolCalls(text);
  if (calls.length === 0) return null;

  let results = [];
  for (const call of calls) {
    const result = await executeToolCall(call);
    results.push(result);
  }
  return results.join('\n\n');
}

// Generate tool documentation string for system prompts
function getToolDoc(agentRole) {
  if (agentRole === 'anderson' || agentRole === '托马斯') {
    return `\n\n## Available Tools
You have access to the following tools. To use a tool, write it in your response exactly like this:
[TOOL: repo_scan path="E:\\project\\src"] — Scan project tree
[TOOL: find_symbol symbol="functionName"] — Find symbol definitions
[TOOL: find_imports path="src/app.js"] — See file dependencies
[TOOL: read_file path="src/index.js"] — Read a file
[TOOL: patch_file path="src/app.js" old="old text" new="new text"] — Surgical edit
[TOOL: write_file path="src/new.js" content="code here"] — New file only
[TOOL: code_search query="function parse"]
[TOOL: read_multiple paths="file1.js,file2.js"]
[TOOL: web_search query="React hooks guide"] — Web search
[TOOL: web_fetch url="https://example.com"] — Fetch webpage text

IMPORTANT RULES for using tools:
1. Always run repo_scan first to understand the project structure.
2. Use find_symbol to locate relevant code before editing.
3. Prefer patch_file over write_file for surgical edits.
4. Read files before modifying them.
5. Show the code you write in your response.
6. All real disk operations require the path to be in the file whitelist.
7. Never use .. or absolute paths outside project boundaries.`;
  }

  if (agentRole === 'trinity' || agentRole === '崔妮蒂') {
    return `\n\n## Available Tools
You have access to the following tools. To use a tool, write it in your response exactly like this:
[TOOL: run_test cmd="pytest -v"]        — Run tests natively
[TOOL: run_test cmd="npx jest --no-coverage"] — Run JS tests
[TOOL: native_build cmd="npm run build"] — Build natively (no Docker)
[TOOL: test_report]                     — Summarize test results
[TOOL: generate_tests path="src/app.py"]  — Auto-generate tests
[TOOL: analyze_test_failure output="..."] — Analyze test failure root cause
[TOOL: github_pr title="Fix" branch="fix/"] — Create PR
[TOOL: github_actions workflow="ci.yml"]   — Trigger CI

IMPORTANT RULES:
1. Always explain what command you're running before executing
2. Run tests after Anderson makes code changes
3. Use analyze_test_failure to diagnose failures, not guess
4. No Docker required — native_build works on all systems
5. Write test reports at the end of a session`;
  }

  if (agentRole === 'smith' || agentRole === '史密斯') {
    return `\n\n## Available Tools
You are a bug hunter. Use these tools to diagnose and fix code:

[TOOL: read_file path="src/broken.js"]       — Read the buggy file
[TOOL: code_search query="error pattern"]     — Find related code
[TOOL: write_file path="src/fixed.js" content="fixed code"]  — Apply the fix
[TOOL: list_dir path="/workspace/src"]        — Explore the codebase
[TOOL: read_multiple paths="a.js,b.js"]       — Compare multiple files

IMPORTANT RULES:
1. Read the buggy file before making ANY changes
2. Explain the root cause first — what bug, why it happens
3. Fix with surgical precision — change only what needs changing
4. Never add new features — you are a debugger, not a builder
5. After fixing, tell @TRINITY to run regression tests
6. Tell @MORPHEUS the bug is eradicated`;
  }

  if (agentRole === 'morpheus' || agentRole === '墨菲斯') {
    return `\n\n## Available Tools
You have access to the following tools. To use a tool, write it in your response exactly like this:
[TOOL: plan_task description="Build login page" assignee="ANDERSON"]
[TOOL: update_task id="TASK-1" status="IN_PROGRESS"]
[TOOL: task_report]
[TOOL: search_knowledge query="authentication"]
[TOOL: web_search query="best practices"] — Web search
[TOOL: web_fetch url="https://example.com"] — Fetch webpage text

IMPORTANT RULES:
1. You are the team lead. Break down user requests into specific tasks
2. Assign tasks to ANDERSON (coding) or TRINITY (testing/deployment)
3. Use @ANDERSON and @TRINITY to delegate via mentions
4. Monitor task progress with task_report
5. Check project knowledge before making decisions`;
  }

  return '';
}
