<div align="center">

<img src="renderer/assets/logo.png" width="120" style="display:none" onerror="this.style.display='none'">

# M A T R I X

### CONSCIOUSNESS ACCESS PROTOCOL

```
> A multi-agent AI coding assistant forged in the digital rain.
> Wake up, Neo...
```

</div>

---

<details open>
<summary><b>🇨🇳 中文</b></summary>

## MATRIX // 意识接入协议

**MATRIX** 是一个 Electron 桌面应用，以《黑客帝国》视觉风格打造的**多 AI Agent 协作编码助手**。它支持本地和云端 LLM，内置工具调用、RAG 记忆、Google 搜索、代码搜索与文件操作，通过 LangGraph 编排多个 Agent 协作完成任务。

> 🟢 代号风格：黑色底色 + 绿色矩阵雨 + 终端美学

### 功能特性

- 🤖 **多 Agent 系统** — 预置 The Architect（架构师）等角色，Agent 间可通过 @mention 协作委派任务
- 🧠 **多 LLM 支持** — Ollama（本地）、OpenAI、Claude、Gemini、DeepSeek 及兼容 OpenAI 接口的自定义提供商
- 🔧 **工具调用** — 读写文件、打补丁、代码搜索、执行命令（沙箱安全）
- 📚 **RAG 记忆** — 向量存储实现上下文检索，跨会话持久记忆
- 🔍 **Google 搜索 & Web 抓取** — Agent 可联网搜索实时信息
- 🎨 **图像生成** — 支持 DALL·E 及兼容接口
- 📊 **Token 用量追踪** — 按模型/Agent/日期统计调用与费用
- 🏗️ **架构决策记录 (ADR)** — 持久化技术决策、模块边界、代码所有权
- 🔒 **沙箱命令执行** — Electron 主进程限制可执行命令类型
- 🌐 **LangGraph 引擎 (Python)** — FastAPI + LangGraph 做 Agent 状态图编排
- ✨ **Matrix 数字雨动画** — 纯 Canvas 实现，致敬经典

### 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Electron 29 |
| 前端 UI | 原生 HTML/CSS/JS（Matrix 主题） |
| Agent 引擎 | Python + LangGraph + FastAPI |
| 向量存储 | 自定义 Chroma-like 实现 |
| LLM 调用 | 兼容 OpenAI Chat Completions 接口 |
| 打包 | electron-builder (NSIS / portable) |

### 快速开始

```bash
# 1. 安装依赖
npm install
pip install -r engine/requirements.txt

# 2. (可选) 启动本地 Ollama
ollama run qwen2.5:7b-instruct

# 3. 启动应用
npm start
```

### 配置 API

将模板文件复制为实际配置：

```bash
cp renderer/data/api_config.template.json renderer/data/api_config.json
cp renderer/data/api_profiles.template.json renderer/data/api_profiles.json
```

然后编辑填入你的 API Key。**切勿提交含真实 Key 的配置文件！**（已通过 `.gitignore` 保护）

### 项目结构

```
MATRIX/
├── main.js              # Electron 主进程
├── preload.js           # 预加载脚本（contextBridge）
├── package.json         # 项目配置
├── renderer/
│   ├── matrix-upload.html  # 主界面
│   ├── css/
│   │   └── style.css       # Matrix 主题样式
│   ├── js/                 # 前端逻辑
│   │   ├── app.js          # 启动 & 全局状态
│   │   ├── api.js          # LLM/搜索/图像 API
│   │   ├── agent.js        # Agent 管理
│   │   ├── chat.js         # 聊天界面
│   │   ├── matrix-rain.js  # 数字雨动画
│   │   └── ...
│   └── data/               # 运行时数据
│       ├── agents.json         # Agent 定义
│       ├── api_config.template.json  # API 配置模板
│       └── .gitkeep
├── engine/               # Python LangGraph 引擎
│   ├── server.py         # FastAPI 服务
│   ├── graph.py          # Agent 状态图
│   ├── memory.py         # RAG 向量存储
│   ├── tools.py          # 工具注册与执行
│   └── requirements.txt  # Python 依赖
└── docs/                 # 设计文档
```

### License

MIT

</details>

<details>
<summary><b>🇺🇸 English</b></summary>

## MATRIX // CONSCIOUSNESS ACCESS PROTOCOL

**MATRIX** is an Electron desktop application — a **multi-AI-agent collaborative coding assistant** wrapped in The Matrix aesthetic. It supports both local and cloud LLMs with built-in tool calling, RAG memory, Google search, code search, and file operations, orchestrating multiple agents through LangGraph.

> 🟢 Aesthetic: black background + green Matrix rain + terminal chic

### Features

- 🤖 **Multi-Agent System** — Pre-built roles like The Architect; agents collaborate via @mentions
- 🧠 **Multi-LLM Support** — Ollama (local), OpenAI, Claude, Gemini, DeepSeek, and custom OpenAI-compatible providers
- 🔧 **Tool Calling** — Read/write files, apply patches, code search, execute commands (sandboxed)
- 📚 **RAG Memory** — Vector store for context retrieval with persistent cross-session memory
- 🔍 **Google Search & Web Fetch** — Agents can search the web for real-time info
- 🎨 **Image Generation** — DALL·E and compatible APIs
- 📊 **Token Usage Tracking** — Per-model / per-agent / per-day stats with cost estimation
- 🏗️ **Architecture Decision Records (ADR)** — Persist tech decisions, module boundaries, file ownership
- 🔒 **Sandboxed Execution** — Electron main process restricts allowed command types
- 🌐 **LangGraph Engine (Python)** — FastAPI + LangGraph for agent state graph orchestration
- ✨ **Matrix Digital Rain** — Pure Canvas animation, a love letter to the classic

### Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron 29 |
| UI | Vanilla HTML/CSS/JS (Matrix theme) |
| Agent Engine | Python + LangGraph + FastAPI |
| Vector Store | Custom Chroma-like implementation |
| LLM Interface | OpenAI Chat Completions compatible |
| Packaging | electron-builder (NSIS / portable) |

### Quick Start

```bash
# 1. Install dependencies
npm install
pip install -r engine/requirements.txt

# 2. (Optional) Start local Ollama
ollama run qwen2.5:7b-instruct

# 3. Launch the app
npm start
```

### API Configuration

Copy the template files to create your actual config:

```bash
cp renderer/data/api_config.template.json renderer/data/api_config.json
cp renderer/data/api_profiles.template.json renderer/data/api_profiles.json
```

Then edit them with your API keys. **Never commit real API keys!** (Protected by `.gitignore`)

### Project Structure

```
MATRIX/
├── main.js              # Electron main process
├── preload.js           # Preload script (contextBridge)
├── package.json         # Project config
├── renderer/
│   ├── matrix-upload.html  # Main UI
│   ├── css/
│   │   └── style.css       # Matrix theme styles
│   ├── js/                 # Frontend logic
│   │   ├── app.js          # Bootstrap & global state
│   │   ├── api.js          # LLM / search / image APIs
│   │   ├── agent.js        # Agent management
│   │   ├── chat.js         # Chat interface
│   │   ├── matrix-rain.js  # Digital rain animation
│   │   └── ...
│   └── data/               # Runtime data
│       ├── agents.json         # Agent definitions
│       ├── api_config.template.json  # API config template
│       └── .gitkeep
├── engine/               # Python LangGraph engine
│   ├── server.py         # FastAPI server
│   ├── graph.py          # Agent state graph
│   ├── memory.py         # RAG vector store
│   ├── tools.py          # Tool registry & execution
│   └── requirements.txt  # Python dependencies
└── docs/                 # Design docs
```

### License

MIT

</details>

<details>
<summary><b>🇯🇵 日本語</b></summary>

## MATRIX // 意識アクセス・プロトコル

**MATRIX** は Electron デスクトップアプリケーション — 映画「マトリックス」の美学で包まれた **マルチ AI エージェント協調コーディングアシスタント**です。ローカルとクラウドの LLM に対応し、ツール呼び出し、RAG メモリ、Google 検索、コード検索、ファイル操作を内蔵。LangGraph で複数エージェントを編成します。

> 🟢 美学：黒背景 + 緑のマトリックスレイン + ターミナルシック

### 機能

- 🤖 **マルチエージェントシステム** — アーキテクトなどの役割をプリセット、@メンションでエージェント間協調
- 🧠 **マルチ LLM 対応** — Ollama（ローカル）、OpenAI、Claude、Gemini、DeepSeek、カスタム OpenAI 互換プロバイダ
- 🔧 **ツール呼び出し** — ファイル読み書き、パッチ適用、コード検索、コマンド実行（サンドボックス）
- 📚 **RAG メモリ** — ベクトルストアによる文脈検索とセッション間永続記憶
- 🔍 **Google 検索 & Web 取得** — エージェントがリアルタイム情報を検索可能
- 🎨 **画像生成** — DALL·E および互換 API
- 📊 **トークン使用量追跡** — モデル別・エージェント別・日別の統計とコスト見積
- 🏗️ **アーキテクチャ決定記録 (ADR)** — 技術判断・モジュール境界・ファイル所有権を永続化
- 🔒 **サンドボックス実行** — Electron メインプロセスが許可コマンド種別を制限
- 🌐 **LangGraph エンジン (Python)** — FastAPI + LangGraph でエージェント状態グラフを編成
- ✨ **マトリックスデジタルレイン** — 純粋 Canvas アニメーション、名作へのオマージュ

### 技術スタック

| 層 | 技術 |
|---|---|
| シェル | Electron 29 |
| UI | バニラ HTML/CSS/JS（マトリックステーマ） |
| エージェントエンジン | Python + LangGraph + FastAPI |
| ベクトルストア | カスタム Chroma 類似実装 |
| LLM インターフェース | OpenAI Chat Completions 互換 |
| パッケージング | electron-builder (NSIS / portable) |

### クイックスタート

```bash
# 1. 依存関係のインストール
npm install
pip install -r engine/requirements.txt

# 2. （オプション）ローカル Ollama 起動
ollama run qwen2.5:7b-instruct

# 3. アプリ起動
npm start
```

### API 設定

テンプレートファイルをコピーして実際の設定を作成：

```bash
cp renderer/data/api_config.template.json renderer/data/api_config.json
cp renderer/data/api_profiles.template.json renderer/data/api_profiles.json
```

その後 API キーを編集して入力してください。**実際の API キーをコミットしないでください！**（`.gitignore` で保護済み）

### プロジェクト構造

```
MATRIX/
├── main.js              # Electron メインプロセス
├── preload.js           # プリロードスクリプト（contextBridge）
├── package.json         # プロジェクト設定
├── renderer/
│   ├── matrix-upload.html  # メイン UI
│   ├── css/
│   │   └── style.css       # マトリックステーマスタイル
│   ├── js/                 # フロントエンドロジック
│   │   ├── app.js          # 起動 & グローバル状態
│   │   ├── api.js          # LLM / 検索 / 画像 API
│   │   ├── agent.js        # エージェント管理
│   │   ├── chat.js         # チャット UI
│   │   ├── matrix-rain.js  # デジタルレイン アニメーション
│   │   └── ...
│   └── data/               # ランタイムデータ
│       ├── agents.json         # エージェント定義
│       ├── api_config.template.json  # API 設定テンプレート
│       └── .gitkeep
├── engine/               # Python LangGraph エンジン
│   ├── server.py         # FastAPI サーバー
│   ├── graph.py          # エージェント状態グラフ
│   ├── memory.py         # RAG ベクトルストア
│   ├── tools.py          # ツール登録 & 実行
│   └── requirements.txt  # Python 依存関係
└──docs/                 # 設計ドキュメント
```

### ライセンス

MIT

</details>

---

<div align="center">
<sub>Follow the white rabbit. 🐇</sub>
</div>
