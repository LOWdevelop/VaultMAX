<div align="center">

# 🧠 VaultMAX

**Second brain for developers — persistent memory MCP server for Cursor & VS Code**

[![Version](https://img.shields.io/badge/Version-2.1.0-blueviolet?style=for-the-badge)](https://github.com/FFloriani/VaultMAX)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blueviolet?style=for-the-badge)](https://modelcontextprotocol.io)
[![OpenAI](https://img.shields.io/badge/OpenAI-Embeddings-412991?style=for-the-badge&logo=openai&logoColor=white)](https://platform.openai.com)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

</div>

---

## 🤔 What is VaultMAX?

VaultMAX is a **local MCP server** that gives your AI assistant a persistent memory across sessions. Install it once on your machine, connect any project via `.mcp.json`, and your AI assistant will never forget a decision, a bug fix, or your project structure again.

- 🗄️ **SQLite** database (Node.js native — no compilation needed)
- 🔍 **Semantic search** via OpenAI embeddings (`text-embedding-3-small`)
- 📝 **Human-readable vault** — every memory is also saved as `.md` files (Obsidian-ready)
- 🪟 **Windows-first** design
- 🔌 **One server, many projects** — just change the `PROJECT` env variable

---

## 🚀 Key Features in v2.1.0

- 🔗 **Dynamic Workspace Resolution (`listRoots()`):** Resolves projects automatically based on the active IDE workspace folders.
- 🗲 **SQLite WAL Concurrency:** Optimized for multi-window concurrent Cursor/VS Code sessions with WAL journal mode and retries.
- 🛡️ **Vector Space Safety & Compatibility:** Never compares vectors from incompatible spaces (e.g. OpenAI vs Local Hash fallbacks), preventing math noise.
- 📊 **Project-Capped Skill Profiles (`vaultmax_profile`):** Generates beautiful professional portfolios using tag aliasing, evidence floor validation, and project-capped scoring to prevent template score inflation.
- 🔄 **Database-Wide Auto-Healing Rebuild:** Global rebuild (`project: "all"`) to restore and auto-heal all legacy vectors to `text-embedding-3-small`.

---

## ⚡ Quick Start

### 1. Prerequisites

- Node.js 22+
- OpenAI API key

### 2. Clone & Build

```bash
git clone https://github.com/LOWdevelop/VaultMAX.git
cd VaultMAX
npm install
npm run build
```

### 3. Configure your project

Create `.cursor/mcp.json` in the root of **your project**:

```json
{
  "mcpServers": {
    "vaultmax": {
      "command": "node",
      "args": ["C:\\Users\\YOUR_USER\\VaultMAX\\dist\\index.js"],
      "env": {
        "PROJECT": "my-project",
        "OPENAI_API_KEY": "sk-...",
        "VAULT_PATH": "C:\\Users\\YOUR_USER\\VaultMAX\\vaults"
      }
    }
  }
}
```

Restart Cursor — the 5 tools will appear automatically in Composer.

---

## 🛠️ The 14 Tools

| Tool | Description |
|------|-------------|
| `vaultmax_brief` | **One-shot context bundle** — constraints + map + recent decisions/lessons + semantic matches for the current task. Designed to give weaker AIs full project context in a single call. |
| `vaultmax_remember` | Save a memory with type, content, tags and importance (1–5). Auto-rejects duplicates (>92% similar). Scopes symbols to active file. |
| `vaultmax_recall` | Semantic search across memories with location boost and temporal ranking decay. |
| `vaultmax_observe` | Hydrate memory IDs with full content. Pick only what you need ("pay-only-what-you-read" pattern). |
| `vaultmax_lesson` | Convert an error+solution into a preventive RULE via AI. Surfaces in `brief` so future tasks avoid the same mistake. |
| `vaultmax_summarize_project` | Regenerate the project map by analyzing all existing memories via AI. Keeps `brief` fresh. |
| `vaultmax_update` | Update memory content by ID (re-embeds). |
| `vaultmax_forget` | Delete a memory permanently. |
| `vaultmax_map` | List all map-type memories, newest first. |
| `vaultmax_profile` | Compile all decisions, lessons, constraints, and project maps into a live professional profile with skill weights and timelines. |
| `vaultmax_promote` | Promote multiple project lesson memories with high similarity into a single unified universal-rule. |
| `vaultmax_supersede` | Replace an outdated memory with a new version. Preserves history but hides old active memory. |
| `vaultmax_handoff` | Generate a dense Markdown handoff bundle for a project. Instantly transfers project context. |
| `vaultmax_rebuild` | Force rebuild of all physical Markdown vaults and Obsidian indexes from the SQLite database rows. |

### Memory Types

```
constraint → inviolable rules (importance auto = 5)
lesson     → preventive rule from past error (importance auto = 4)
decision   → architectural choices, libraries, patterns adopted
error      → bugs found, root cause, solution applied
map        → where things live in the project
change     → what changed in each work session
```

---

## 📂 Vault Structure

Every memory is stored in two places simultaneously:

```
vaults/
└── my-project/
    ├── decisions.md   ← architectural decisions
    ├── changelog.md   ← errors resolved + changes
    └── map.md         ← project structure map
```

Open `vaults/` as a vault in **Obsidian** for a beautiful knowledge base of your project.

---

## 🤖 Auto-Memory Rules for Cursor

Copy `templates/cursorrules.md` content into your project's `.cursorrules` file to make Cursor automatically use VaultMAX on every interaction — recalling context before tasks and saving memories after.

---

## 🏗️ Architecture

```
src/
├── index.ts              ← MCP server entry point (5 tools registered)
├── tools/
│   ├── remember.ts       ← embed + save to SQLite + write .md
│   ├── recall.ts         ← embed query + cosine similarity search
│   ├── update.ts         ← re-embed + update SQLite + update .md
│   ├── forget.ts         ← delete from SQLite + remove from .md
│   └── map.ts            ← list map-type memories
├── db/
│   ├── schema.ts         ← SQLite table definition
│   └── client.ts         ← CRUD functions (node:sqlite)
├── embeddings/
│   └── openai.ts         ← generate, serialize, cosine similarity
└── vault/
    └── writer.ts         ← .md file management
```

**Storage:** Embeddings are stored as JSON strings (`text-embedding-3-small`, 1536 dimensions). Similarity search uses pure JavaScript cosine similarity — no native extensions required.

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | OpenAI API key (required) |
| `PROJECT` | `default` | Current project name |
| `VAULT_PATH` | `./vaults` | Absolute path to vaults folder |
| `VAULTMAX_DB_PATH` | `vaultmax.db` | Absolute path to a custom SQLite database file (useful for test isolation) |
| `VAULT_IDENTITY` | `floriani` | Identity folder name for developer professional profile (used under `_profiles/`) |

---

## 📦 Multiple Projects

The same VaultMAX installation serves unlimited projects. Each project gets its own isolated vault:

```json
{ "PROJECT": "project-alpha" }   →   vaults/project-alpha/
{ "PROJECT": "project-beta"  }   →   vaults/project-beta/
```

---

<div align="center">

Built with ❤️ to stop repeating the same mistakes across sessions.

<br/>

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/lowdevelop)

</div>
