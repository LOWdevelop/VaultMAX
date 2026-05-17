# VaultMAX

MCP server local que funciona como segundo cérebro para projetos de desenvolvimento. Instalado uma vez no PC, conectado ao Cursor via `.cursor/mcp.json`. Cada projeto passa seu nome via variável de ambiente `PROJECT` — o vault do projeto é criado automaticamente se não existir.

---

## Pré-requisitos

- **Node.js 22+** (usa `node:sqlite` nativo)
- **Conta OpenAI** com acesso à API (modelo `text-embedding-3-small`)

---

## Instalação no Windows

```bash
# 1. Clone ou copie a pasta vaultmax para um local fixo
cd C:\Users\SEU_USUARIO
git clone <repo> vaultmax
cd vaultmax

# 2. Instale as dependências
npm install

# 3. Compile o TypeScript
npm run build

# 4. Crie o arquivo de ambiente
copy .env.example .env
# Edite .env e preencha OPENAI_API_KEY
```

---

## Configurar primeiro projeto

Crie o arquivo `.cursor/mcp.json` na raiz do seu projeto:

```json
{
  "mcpServers": {
    "vaultmax": {
      "command": "node",
      "args": ["C:\\Users\\SEU_USUARIO\\vaultmax\\dist\\index.js"],
      "env": {
        "PROJECT": "meu-projeto",
        "OPENAI_API_KEY": "sk-...",
        "VAULT_PATH": "C:\\Users\\SEU_USUARIO\\vaultmax\\vaults"
      }
    }
  }
}
```

Reinicie o Cursor. O VaultMAX aparece como MCP ativo.

---

## Configurar segundo projeto

No segundo projeto, crie `.cursor/mcp.json` igual ao anterior, apenas mudando `PROJECT`:

```json
{
  "mcpServers": {
    "vaultmax": {
      "command": "node",
      "args": ["C:\\Users\\SEU_USUARIO\\vaultmax\\dist\\index.js"],
      "env": {
        "PROJECT": "outro-projeto",
        "OPENAI_API_KEY": "sk-...",
        "VAULT_PATH": "C:\\Users\\SEU_USUARIO\\vaultmax\\vaults"
      }
    }
  }
}
```

Cada projeto tem seu vault isolado em `vaults/<PROJECT>/`.

---

## As 5 tools

| Tool | O que faz |
|------|-----------|
| `vaultmax_remember` | Salva uma memória com tipo, conteúdo e tags opcionais |
| `vaultmax_recall` | Busca memórias por similaridade semântica (linguagem natural) |
| `vaultmax_update` | Atualiza o conteúdo de uma memória existente pelo ID |
| `vaultmax_forget` | Apaga permanentemente uma memória pelo ID |
| `vaultmax_map` | Lista todas as memórias do tipo "map" do projeto |

### Tipos de memória

- **decision** — escolhas arquiteturais, bibliotecas, padrões
- **error** — bugs encontrados, causa raiz e solução
- **map** — mapa do projeto (onde fica cada coisa)
- **change** — o que foi alterado em cada sessão

---

## Vault no Obsidian

Abra a pasta `vaults/` como vault no Obsidian:

1. Obsidian → "Open folder as vault"
2. Selecione `C:\Users\SEU_USUARIO\vaultmax\vaults`

Cada projeto aparece como uma pasta com três arquivos:
- `decisions.md` — decisões arquiteturais
- `changelog.md` — erros resolvidos e mudanças
- `map.md` — mapa estrutural do projeto

---

## Configurar regras no Cursor

Copie o conteúdo de `templates/cursorrules.md` para o `.cursorrules` do seu projeto para que o Composer use a memória automaticamente em toda interação.

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `OPENAI_API_KEY` | — | Chave da API OpenAI (obrigatória) |
| `PROJECT` | `default` | Nome do projeto atual |
| `VAULT_PATH` | `./vaults` | Caminho absoluto para a pasta de vaults |

---

## Banco de dados

O VaultMAX cria `vaultmax.db` (SQLite via `node:sqlite`) na pasta onde o servidor é executado. Embeddings são armazenados como JSON (`text-embedding-3-small`, 1536 dimensões) e a busca usa cosine similarity calculada em JavaScript puro.
