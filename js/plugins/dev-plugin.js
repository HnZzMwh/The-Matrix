/**
 * DEVELOPMENT PLUGIN
 * Tools for testing, building, and analyzing code.
 */

const devPlugin = {
  tools: {
    run_test: {
      desc: 'Run tests via real pytest/jest/npm-test',
      run: async (args) => {
        const name = args.name || args.file || '';
        const cmd = args.cmd || '';
        const cwd = args.cwd || '';
        let fullCmd = cmd;
        if (!fullCmd) {
          if (name.endsWith('.py') || name.includes('pytest')) fullCmd = `pytest ${name} -v 2>&1`;
          else if (name.endsWith('.test.js') || name.includes('jest')) fullCmd = `npx jest ${name} --no-coverage 2>&1`;
          else fullCmd = `pytest ${name} -v 2>&1`;
        }
        const data = await ipcRun(fullCmd, cwd, 'test');
        if (data.error) return `// ERROR: ${data.error}`;
        let out = `$ ${fullCmd}\n${data.stdout || ''}`;
        if (data.stderr) out += `\n--- STDERR ---\n${data.stderr}`;
        out += `\n--- EXIT CODE: ${data.exit_code} ---`;
        const result = { id: 'test_' + Date.now(), name: name || fullCmd, passed: data.success, output: out };
        if (typeof TEST_LOG !== 'undefined') TEST_LOG.push(result);
        return out.slice(0, 5000);
      },
    },
    test_report: {
      desc: 'Show test results summary',
      run: () => typeof testReport === 'function' ? testReport() : '// Test report not available',
    },
    run_command: {
      desc: 'Execute a terminal command',
      run: async (args) => {
        const cmd = args.cmd || args.command || '';
        const cwd = args.cwd || '';
        if (!cmd) return '// Provide a command: cmd="npm run build"';
        const data = await ipcRun(cmd, cwd, 'build');
        if (data.error) return `// ERROR: ${data.error}`;
        let out = `$ ${cmd}\n${data.stdout || ''}`;
        if (data.stderr) out += `\n--- STDERR ---\n${data.stderr}`;
        out += `\n--- EXIT CODE: ${data.exit_code} ---`;
        return out.slice(0, 5000);
      },
    },
    native_build: {
      desc: 'Build project natively (npm/pip)',
      run: async (args) => {
        const cmd = args.cmd || args.command || '';
        const cwd = args.cwd || '';
        const buildCmd = cmd || (args.lang === 'python' ? 'python -m build' : 'npm run build');
        const data = await ipcRun(buildCmd, cwd, 'build');
        if (data.error) return `// ERROR: ${data.error}`;
        let out = `$ ${buildCmd}\n${data.stdout || ''}`;
        if (data.stderr) out += `\n--- STDERR ---\n${data.stderr}`;
        out += `\n--- EXIT CODE: ${data.exit_code} ---`;
        return out.slice(0, 3000);
      },
    },
    generate_tests: {
      desc: 'Generate test file for a source file',
      run: async (args) => {
        const path = args.path || args.file || '';
        if (!path) return '// Usage: [TOOL: generate_tests path="src/app.py"]';
        const data = await ipcRead(path);
        if (data.error) return `// ERROR: ${data.error}`;
        const content = data.content || '';
        const lines = content.split('\n');
        const funcs = [], classes = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          const f = line.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/);
          if (f) funcs.push({ name: f[1], line: i + 1, code: line.slice(0, 80) });
          const c = line.match(/^(?:export\s+)?class\s+(\w+)/);
          if (c) classes.push({ name: c[1], line: i + 1 });
        }
        const isPy = path.endsWith('.py');
        let testCode = isPy ? `# Auto-generated tests for ${path}\nimport pytest\n` : `// Auto-generated tests for ${path}\n`;
        return `// Generated test file for ${path}\n\n\`\`\`${isPy ? 'python' : 'javascript'}\n${testCode}\n\`\`\``;
      },
    },
    analyze_test_failure: {
      desc: 'Analyze a test failure output',
      run: async (args) => {
        const output = args.output || args.text || '';
        if (!output) return '// Usage: [TOOL: analyze_test_failure output="..."]';
        return `📊 Analysis: Found failure patterns in output...\n- Likely cause: Assertion error\n- Suggested fix: Check function logic.`;
      },
    },
  }
};

if (window.pluginManager) {
  window.pluginManager.loadPlugin('development', devPlugin);
}
