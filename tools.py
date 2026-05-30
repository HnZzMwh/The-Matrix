import os, subprocess, json, re, fnmatch, hashlib
from pathlib import Path
from typing import Optional, List, Dict, Any

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

def read_file(path: str) -> str:
    full = path if os.path.isabs(path) else os.path.join(ROOT_DIR, path)
    if not os.path.exists(full):
        return f"Error: file not found: {path}"
    with open(full, 'r', encoding='utf-8', errors='replace') as f:
        return f.read()

def write_file(path: str, content: str) -> str:
    full = path if os.path.isabs(path) else os.path.join(ROOT_DIR, path)
    d = os.path.dirname(full)
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)
    with open(full, 'w', encoding='utf-8') as f:
        f.write(content)
    return f"Written {len(content)} bytes to {path}"

def patch_file(path: str, old_str: str, new_str: str) -> str:
    full = path if os.path.isabs(path) else os.path.join(ROOT_DIR, path)
    if not os.path.exists(full):
        return f"Error: file not found: {path}"
    with open(full, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    if old_str not in content:
        return f"Error: old_str not found in {path}"
    content = content.replace(old_str, new_str, 1)
    with open(full, 'w', encoding='utf-8') as f:
        f.write(content)
    return f"Patched {path}: replaced 1 occurrence"

def list_dir(path: str = '.') -> str:
    full = path if os.path.isabs(path) else os.path.join(ROOT_DIR, path)
    if not os.path.exists(full):
        return f"Error: path not found: {path}"
    try:
        items = os.listdir(full)
        lines = []
        for name in sorted(items):
            fp = os.path.join(full, name)
            t = 'd' if os.path.isdir(fp) else 'f'
            lines.append(f"[{t}] {name}")
        return '\n'.join(lines)
    except PermissionError:
        return f"Error: permission denied: {path}"

def run_command(cmd: str, cwd: Optional[str] = None) -> str:
    cwd = cwd or ROOT_DIR
    forbidden = [';', '|', '&&', '||', '`', '$', '>', '<']
    for ch in forbidden:
        if ch in cmd:
            return f"Error: shell chaining character '{ch}' blocked"
    allowed_bases = ['pytest', 'python', 'npm', 'npx', 'node', 'pip', 'dir', 'ls', 'cat', 'type', 'echo']
    base = cmd.split()[0].lower() if cmd.split() else ''
    if base not in allowed_bases:
        return f"Error: '{base}' not in allowed commands"
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd, timeout=60)
        out = (r.stdout or '') + '\n' + (r.stderr or '')
        return out.strip()[:8000]
    except subprocess.TimeoutExpired:
        return "Error: command timed out (60s)"
    except Exception as e:
        return f"Error: {e}"

def code_search(pattern: str, include: str = '*.py') -> str:
    matches = []
    for root, dirs, files in os.walk(ROOT_DIR):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d != 'node_modules' and d != '__pycache__']
        for f in files:
            if not fnmatch.fnmatch(f, include):
                continue
            fp = os.path.join(root, f)
            try:
                with open(fp, 'r', encoding='utf-8', errors='replace') as fh:
                    for i, line in enumerate(fh, 1):
                        if pattern in line:
                            rel = os.path.relpath(fp, ROOT_DIR)
                            matches.append(f"{rel}:{i}: {line.rstrip()[:120]}")
            except:
                pass
    return '\n'.join(matches[:100]) or f"No matches for '{pattern}'"

def repo_tree(path: str = '.', max_depth: int = 3) -> str:
    full = path if os.path.isabs(path) else os.path.join(ROOT_DIR, path)
    lines = []
    def walk(p, d):
        if d > max_depth: return
        try:
            for name in sorted(os.listdir(p)):
                fp = os.path.join(p, name)
                is_dir = os.path.isdir(fp)
                prefix = '  ' * d + ('d ' if is_dir else '  ')
                lines.append(f"{prefix}{name}")
                if is_dir and not name.startswith('.') and name != 'node_modules' and name != '__pycache__':
                    walk(fp, d + 1)
        except PermissionError:
            pass
    walk(full, 0)
    return '\n'.join(lines[:200])

def repo_scan(include: str = '*.py') -> str:
    files = []
    for root, dirs, fnames in os.walk(ROOT_DIR):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d != 'node_modules' and d != '__pycache__']
        for f in fnames:
            if fnmatch.fnmatch(f, include):
                rel = os.path.relpath(os.path.join(root, f), ROOT_DIR)
                files.append(rel)
    return '\n'.join(sorted(files)[:200])

TOOL_REGISTRY = {
    "read_file": read_file,
    "write_file": write_file,
    "patch_file": patch_file,
    "list_dir": list_dir,
    "run_command": run_command,
    "code_search": code_search,
    "repo_tree": repo_tree,
    "repo_scan": repo_scan,
}

TOOL_DESCRIPTIONS = {
    "read_file": "read_file path='<filepath>' — Read file contents",
    "write_file": "write_file path='<filepath>' content='<text>' — Write content to file (overwrites)",
    "patch_file": "patch_file path='<filepath>' old_str='<text>' new_str='<text>' — Replace first occurrence of old_str with new_str",
    "list_dir": "list_dir path='<dirpath>' — List directory contents",
    "run_command": "run_command cmd='<command>' cwd='<dir>' — Run shell command (60s timeout)",
    "code_search": "code_search pattern='<text>' include='*.py' — Search code for pattern",
    "repo_tree": "repo_tree path='.' max_depth=3 — Show directory tree",
    "repo_scan": "repo_scan include='*.py' — List all matching files in repo",
}

def parse_tool_calls(text: str) -> List[Dict[str, Any]]:
    calls = []
    for m in re.finditer(r'\[TOOL:\s*(\w+)\s*([^\]]*)\]', text):
        name = m.group(1)
        args_str = m.group(2).strip()
        args = {}
        for kv in re.finditer(r'(\w+)\s*=\s*"((?:\\.|[^"\\])*)"', args_str):
            args[kv.group(1)] = kv.group(2).replace('\\"', '"').replace('\\n', '\n')
        calls.append({"name": name, "args": args, "full": m.group(0)})
    return calls

def execute_tool(name: str, args: Dict[str, str]) -> str:
    fn = TOOL_REGISTRY.get(name)
    if not fn:
        return f"Error: unknown tool '{name}'"
    try:
        result = fn(**args)
        return str(result) if result is not None else "(empty)"
    except TypeError as e:
        return f"Error: invalid args for {name}: {e}"
    except Exception as e:
        return f"Error: {e}"
