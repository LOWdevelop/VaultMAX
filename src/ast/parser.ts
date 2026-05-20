import path from 'path';
import Parser from 'web-tree-sitter';

export interface ASTSymbol {
  name: string;
  type: 'class' | 'function' | 'method' | 'interface' | 'variable';
  startLine?: number;
  endLine?: number;
  params?: string;
}

// --- Language detection (expanded) ---

const EXT_MAP: Record<string, string> = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'tsx',
  '.py': 'python', '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.php': 'php',
  '.rb': 'ruby',
  '.css': 'css',
  '.scss': 'css',
};

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_MAP[ext] ?? 'text';
}

// --- Tree-sitter singleton init ---

let _initialized = false;
const _languages: Map<string, any> = new Map();

async function ensureInit(): Promise<void> {
  if (_initialized) return;
  try {
    // Locate the tree-sitter.wasm runtime from web-tree-sitter package
    const wasmPath = path.join(
      __dirname, '..', '..', 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'
    );
    await Parser.init({ locateFile: () => wasmPath });
    _initialized = true;
  } catch (err) {
    console.error('[VaultMAX AST] Tree-sitter init failed, falling back to regex:', (err as Error).message);
  }
}

async function getLanguage(lang: string): Promise<any | null> {
  if (_languages.has(lang)) return _languages.get(lang);

  try {
    await ensureInit();

    const grammarFile = `tree-sitter-${lang}.wasm`;
    const grammarPath = path.join(
      __dirname, '..', '..', 'node_modules', 'tree-sitter-wasms', 'out', grammarFile
    );
    const language = await Parser.Language.load(grammarPath);
    _languages.set(lang, language);
    return language;
  } catch (err) {
    console.error(`[VaultMAX AST] Failed to load grammar for '${lang}':`, (err as Error).message);
    return null;
  }
}

// --- Tree-sitter symbol extraction queries per language ---

const QUERIES: Record<string, string> = {
  javascript: `
    (class_declaration name: (identifier) @class_name) @class
    (function_declaration name: (identifier) @func_name) @func
    (method_definition name: (property_identifier) @method_name) @method
    (arrow_function) @arrow
    (variable_declarator name: (identifier) @var_name value: (arrow_function)) @arrow_assign
    (export_statement declaration: (function_declaration name: (identifier) @export_func_name)) @export_func
    (export_statement declaration: (class_declaration name: (identifier) @export_class_name)) @export_class
  `,
  typescript: `
    (class_declaration name: (type_identifier) @class_name) @class
    (function_declaration name: (identifier) @func_name) @func
    (method_definition name: (property_identifier) @method_name) @method
    (interface_declaration name: (type_identifier) @iface_name) @iface
    (variable_declarator name: (identifier) @var_name value: (arrow_function)) @arrow_assign
    (export_statement declaration: (function_declaration name: (identifier) @export_func_name)) @export_func
    (export_statement declaration: (class_declaration name: (type_identifier) @export_class_name)) @export_class
  `,
  tsx: `
    (class_declaration name: (type_identifier) @class_name) @class
    (function_declaration name: (identifier) @func_name) @func
    (method_definition name: (property_identifier) @method_name) @method
    (interface_declaration name: (type_identifier) @iface_name) @iface
    (variable_declarator name: (identifier) @var_name value: (arrow_function)) @arrow_assign
  `,
  python: `
    (class_definition name: (identifier) @class_name) @class
    (function_definition name: (identifier) @func_name) @func
    (decorated_definition definition: (function_definition name: (identifier) @deco_func_name)) @deco
  `,
  go: `
    (function_declaration name: (identifier) @func_name) @func
    (method_declaration name: (field_identifier) @method_name) @method
    (type_declaration (type_spec name: (type_identifier) @type_name)) @type
  `,
  rust: `
    (function_item name: (identifier) @func_name) @func
    (struct_item name: (type_identifier) @struct_name) @struct
    (impl_item type: (type_identifier) @impl_name) @impl
    (trait_item name: (type_identifier) @trait_name) @trait
    (enum_item name: (type_identifier) @enum_name) @enum
  `,
  java: `
    (class_declaration name: (identifier) @class_name) @class
    (method_declaration name: (identifier) @method_name) @method
    (interface_declaration name: (identifier) @iface_name) @iface
    (constructor_declaration name: (identifier) @ctor_name) @ctor
  `,
  php: `
    (class_declaration name: (name) @class_name) @class
    (function_definition name: (name) @func_name) @func
    (method_declaration name: (name) @method_name) @method
  `,
  ruby: `
    (class name: (constant) @class_name) @class
    (method name: (identifier) @method_name) @method
    (singleton_method name: (identifier) @smethod_name) @smethod
  `,
};

// --- Main extraction function ---

/**
 * Extracts symbols from source code using Tree-sitter WASM parser.
 * Falls back to regex-based extraction if Tree-sitter is unavailable.
 */
export async function extractSymbolsAsync(code: string, language: string): Promise<ASTSymbol[]> {
  const lang = getLanguage(language);
  const tsLang = await lang;

  if (!tsLang || !QUERIES[language]) {
    // Fallback to regex parser for unsupported languages
    return extractSymbolsRegex(code, language);
  }

  try {
    const parser = new Parser();
    parser.setLanguage(tsLang);
    const tree = parser.parse(code);
    const rootNode = tree.rootNode;

    const symbols: ASTSymbol[] = [];
    const seen = new Set<string>();

    // Walk the tree recursively
    walkNode(rootNode, symbols, seen, language);

    parser.delete();
    tree.delete();

    return symbols;
  } catch (err) {
    console.error(`[VaultMAX AST] Tree-sitter parse failed for '${language}', using regex fallback:`, (err as Error).message);
    return extractSymbolsRegex(code, language);
  }
}

function walkNode(node: any, symbols: ASTSymbol[], seen: Set<string>, language: string): void {
  const nodeType = node.type;

  // JavaScript / TypeScript / TSX
  if (language === 'javascript' || language === 'typescript' || language === 'tsx') {
    if (nodeType === 'class_declaration' || nodeType === 'class') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'class', node);
    }
    if (nodeType === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'function', node);
    }
    if (nodeType === 'method_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'method', node);
    }
    if (nodeType === 'interface_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'interface', node);
    }
    if (nodeType === 'variable_declarator') {
      const nameNode = node.childForFieldName('name');
      const valueNode = node.childForFieldName('value');
      if (nameNode && valueNode && valueNode.type === 'arrow_function') {
        addSymbol(symbols, seen, nameNode.text, 'function', node);
      }
    }
  }

  // Python
  if (language === 'python') {
    if (nodeType === 'class_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'class', node);
    }
    if (nodeType === 'function_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'function', node);
    }
  }

  // Go
  if (language === 'go') {
    if (nodeType === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'function', node);
    }
    if (nodeType === 'method_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'method', node);
    }
    if (nodeType === 'type_spec') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'class', node);
    }
  }

  // Rust
  if (language === 'rust') {
    if (nodeType === 'function_item') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'function', node);
    }
    if (nodeType === 'struct_item' || nodeType === 'enum_item' || nodeType === 'trait_item') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'class', node);
    }
    if (nodeType === 'impl_item') {
      const typeNode = node.childForFieldName('type');
      if (typeNode) addSymbol(symbols, seen, typeNode.text, 'class', node);
    }
  }

  // Java
  if (language === 'java') {
    if (nodeType === 'class_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'class', node);
    }
    if (nodeType === 'method_declaration' || nodeType === 'constructor_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'method', node);
    }
    if (nodeType === 'interface_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'interface', node);
    }
  }

  // PHP
  if (language === 'php') {
    if (nodeType === 'class_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'class', node);
    }
    if (nodeType === 'function_definition' || nodeType === 'method_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'function', node);
    }
  }

  // Ruby
  if (language === 'ruby') {
    if (nodeType === 'class') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'class', node);
    }
    if (nodeType === 'method' || nodeType === 'singleton_method') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addSymbol(symbols, seen, nameNode.text, 'method', node);
    }
  }

  // Recurse into children
  for (let i = 0; i < node.childCount; i++) {
    walkNode(node.child(i), symbols, seen, language);
  }
}

function addSymbol(
  symbols: ASTSymbol[], seen: Set<string>,
  name: string, type: ASTSymbol['type'], node: any
): void {
  const key = `${type}:${name}`;
  if (seen.has(key) || !name.trim()) return;
  seen.add(key);
  symbols.push({
    name: name.trim(),
    type,
    startLine: node.startPosition?.row,
    endLine: node.endPosition?.row,
  });
}

// --- Legacy regex-based fallback (for unsupported languages or init failure) ---

export function extractSymbols(code: string, language: string): ASTSymbol[] {
  return extractSymbolsRegex(code, language);
}

function extractSymbolsRegex(code: string, language: string): ASTSymbol[] {
  const symbols: ASTSymbol[] = [];
  const lines = code.split(/\r?\n/);
  const seen = new Set<string>();

  const addSym = (name: string, type: ASTSymbol['type']) => {
    const cleanName = name.trim();
    if (!cleanName) return;
    const key = `${type}:${cleanName}`;
    if (!seen.has(key)) {
      seen.add(key);
      symbols.push({ name: cleanName, type });
    }
  };

  const isJsTs = language === 'javascript' || language === 'typescript' || language === 'tsx';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    if (isJsTs) {
      const classMatch = trimmed.match(/^export\s+(?:default\s+)?class\s+([a-zA-Z0-9_$]+)/) ||
                         trimmed.match(/^class\s+([a-zA-Z0-9_$]+)/);
      if (classMatch) { addSym(classMatch[1], 'class'); continue; }

      const funcMatch = trimmed.match(/^export\s+(?:default\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/) ||
                        trimmed.match(/^(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/);
      if (funcMatch) { addSym(funcMatch[1], 'function'); continue; }

      const arrowMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/);
      if (arrowMatch) { addSym(arrowMatch[1], 'function'); continue; }

      const methodMatch = trimmed.match(/^(?:async\s+)?([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/);
      if (methodMatch) {
        const name = methodMatch[1];
        const jsKeywords = ['if', 'for', 'while', 'catch', 'switch', 'with', 'function'];
        if (!jsKeywords.includes(name)) addSym(name, 'function');
      }
    } else if (language === 'python') {
      const classMatch = trimmed.match(/^class\s+([a-zA-Z0-9_]+)/);
      if (classMatch) { addSym(classMatch[1], 'class'); continue; }

      const defMatch = trimmed.match(/^def\s+([a-zA-Z0-9_]+)\s*\(/);
      if (defMatch) { addSym(defMatch[1], 'function'); }
    } else if (language === 'go') {
      const funcMatch = trimmed.match(/^func\s+(?:\([^)]+\)\s*)?([a-zA-Z0-9_]+)\s*\(/);
      if (funcMatch) { addSym(funcMatch[1], 'function'); }
    }
  }

  return symbols;
}
