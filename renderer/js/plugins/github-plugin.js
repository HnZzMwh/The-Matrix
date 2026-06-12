/**
 * GITHUB PLUGIN — Tools for agents to interact with GitHub
 */

const githubPlugin = {
  tools: {
    github_list_repos: {
      desc: 'List your GitHub repositories (requires token in [API] panel)',
      run: async (args) => {
        if (!window.GitHub || !window.GitHub.token()) return '// Please configure GitHub token in [API] panel first';
        try {
          const repos = await window.GitHub.listMyRepos(1, 30);
          if (!repos.length) return '// No repositories found';
          return repos.map(r =>
            `  [${r.private ? '🔒' : '🌐'}] ${r.full_name}${r.language ? ' (' + r.language + ')' : ''}${r.stargazers_count ? ' ★' + r.stargazers_count : ''}\n    ${r.description || '(no description)'}\n    Clone: ${r.clone_url}`
          ).join('\n\n');
        } catch (e) {
          return `// GitHub error: ${e.message}`;
        }
      },
    },
    github_list_starred: {
      desc: 'List your starred repositories on GitHub',
      run: async (args) => {
        if (!window.GitHub || !window.GitHub.token()) return '// Please configure GitHub token in [API] panel first';
        try {
          const repos = await window.GitHub.listStarredRepos(1, 30);
          if (!repos.length) return '// No starred repos';
          return repos.map(r =>
            `  ★ ${r.full_name}${r.language ? ' (' + r.language + ')' : ''} ★${r.stargazers_count}\n    ${r.description || ''}\n    ${r.html_url}`
          ).join('\n\n');
        } catch (e) {
          return `// GitHub error: ${e.message}`;
        }
      },
    },
    github_read_file: {
      desc: 'Read a file from a GitHub repository. Args: owner, repo, path (e.g. src/main.py)',
      run: async (args) => {
        const owner = args.owner || '';
        const repo = args.repo || '';
        const filePath = args.path || '';
        if (!owner || !repo || !filePath) return '// Usage: github_read_file owner="name" repo="name" path="file.js"';
        if (!window.GitHub || !window.GitHub.token()) return '// Please configure GitHub token';
        try {
          const content = await window.GitHub.readRepoFile(owner, repo, filePath);
          if (!content) return '// File not found or empty';
          const ext = (filePath.split('.').pop() || '').toLowerCase();
          return '```' + ext + '\n' + content.slice(0, 15000) + '\n```';
        } catch (e) {
          return `// Failed to read ${owner}/${repo}/${filePath}: ${e.message}`;
        }
      },
    },
    github_write_file: {
      desc: 'Write/update a file in a GitHub repo. Args: owner, repo, path, content, message (commit msg), branch (optional, default main)',
      run: async (args) => {
        const owner = args.owner || '';
        const repo = args.repo || '';
        const filePath = args.path || '';
        const content = args.content || '';
        const message = args.message || `Update ${filePath}`;
        const branch = args.branch || 'main';
        if (!owner || !repo || !filePath || !content) return '// Usage: github_write_file owner="name" repo="name" path="file.js" content="..." message="commit msg"';
        if (!window.GitHub || !window.GitHub.token()) return '// Please configure GitHub token';
        try {
          const result = await window.GitHub.writeRepoFile(owner, repo, filePath, content, message, branch);
          return `// ✅ Committed to ${owner}/${repo}/${filePath}\n// SHA: ${result.content?.sha || 'N/A'}\n// URL: ${result.content?.html_url || ''}`;
        } catch (e) {
          return `// Failed to write ${owner}/${repo}/${filePath}: ${e.message}`;
        }
      },
    },
    github_create_pr: {
      desc: 'Create a pull request. Args: owner, repo, title, head (branch), base (default main), body (optional)',
      run: async (args) => {
        const owner = args.owner || '';
        const repo = args.repo || '';
        const title = args.title || 'Auto PR';
        const head = args.head || '';
        const base = args.base || 'main';
        const body = args.body || '';
        if (!owner || !repo || !head) return '// Usage: github_create_pr owner="name" repo="name" title="PR title" head="feature-branch"';
        if (!window.GitHub || !window.GitHub.token()) return '// Please configure GitHub token';
        try {
          const pr = await window.GitHub.createPR(owner, repo, title, head, base, body);
          return `// ✅ PR created: ${pr.html_url}\n// #${pr.number} ${pr.title}`;
        } catch (e) {
          return `// PR creation failed: ${e.message}`;
        }
      },
    },
  }
};

if (window.pluginManager) {
  window.pluginManager.loadPlugin('github', githubPlugin);
}
