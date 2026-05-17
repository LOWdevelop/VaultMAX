<div align="center">

# 🧠 VaultMAX

**Second brain for developers — persistent memory MCP server for Cursor**

[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blueviolet?style=for-the-badge)](https://modelcontextprotocol.io)
[![OpenAI](https://img.shields.io/badge/OpenAI-Embeddings-412991?style=for-the-badge&logo=openai&logoColor=white)](https://platform.openai.com)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

</div>

---

## 🤔 What is VaultMAX?

VaultMAX is a **local MCP server** that gives your AI assistant a persistent memory across sessions. Install it once on your machine, connect any project via `.cursor/mcp.json`, and your Cursor Composer will never forget a decision, a bug fix, or your project structure again.

- 🗄️ **SQLite** database (Node.js native — no compilation needed)
- 🔍 **Semantic search** via OpenAI embeddings (`text-embedding-3-small`)
- 📝 **Human-readable vault** — every memory is also saved as `.md` files (Obsidian-ready)
- 🪟 **Windows-first** design
- 🔌 **One server, many projects** — just change the `PROJECT` env variable

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

## 🛠️ The 5 Tools

| Tool | Description |
|------|-------------|
| `vaultmax_remember` | Save a memory with type, content and optional tags |
| `vaultmax_recall` | Semantic search — ask in natural language |
| `vaultmax_update` | Update an existing memory by ID |
| `vaultmax_forget` | Delete a memory permanently by ID |
| `vaultmax_map` | List all structural map entries for the project |

### Memory Types

```
decision → architectural choices, libraries, patterns adopted
error    → bugs found, root cause, solution applied
map      → where things live in the project
change   → what changed in each work session
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
