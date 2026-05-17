import fs from 'fs';
import path from 'path';

type MemoryType = 'decision' | 'error' | 'map' | 'change';

const FILE_MAP: Record<MemoryType, string> = {
  decision: 'decisions.md',
  error: 'changelog.md',
  change: 'changelog.md',
  map: 'map.md',
};

const FILE_TITLES: Record<string, string> = {
  'decisions.md': 'Decisions',
  'changelog.md': 'Changelog',
  'map.md': 'Map',
};

function getFilePath(project: string, type: MemoryType, vaultPath: string): string {
  return path.join(vaultPath, project, FILE_MAP[type]);
}

export function ensureVaultExists(project: string, vaultPath: string): void {
  const projectDir = path.join(vaultPath, project);
  fs.mkdirSync(projectDir, { recursive: true });

  for (const [file, title] of Object.entries(FILE_TITLES)) {
    const filePath = path.join(projectDir, file);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, `# ${project} — ${title}\n\n`, 'utf8');
    }
  }
}

export function appendToVault(
  project: string,
  type: MemoryType,
  content: string,
  id: string,
  vaultPath: string
): void {
  ensureVaultExists(project, vaultPath);
  const filePath = getFilePath(project, type, vaultPath);
  const date = new Date().toISOString().split('T')[0];
  const entry = `\n<!-- memory:${id} -->\n## ${date}\n${content}\n---\n<!-- /memory:${id} -->\n`;
  fs.appendFileSync(filePath, entry, 'utf8');
}

export function removeFromVault(project: string, id: string, vaultPath: string): void {
  const candidates = [
    path.join(vaultPath, project, 'decisions.md'),
    path.join(vaultPath, project, 'changelog.md'),
    path.join(vaultPath, project, 'map.md'),
  ];

  const pattern = new RegExp(
    `\\n<!-- memory:${id} -->[\\s\\S]*?<!-- /memory:${id} -->\\n`,
    'g'
  );

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const original = fs.readFileSync(filePath, 'utf8');
    const updated = original.replace(pattern, '');
    if (updated !== original) {
      fs.writeFileSync(filePath, updated, 'utf8');
      return;
    }
  }
}

export function updateInVault(
  project: string,
  id: string,
  newContent: string,
  vaultPath: string
): void {
  const candidates = [
    path.join(vaultPath, project, 'decisions.md'),
    path.join(vaultPath, project, 'changelog.md'),
    path.join(vaultPath, project, 'map.md'),
  ];

  const pattern = new RegExp(
    `(<!-- memory:${id} -->)[\\s\\S]*?(<!-- /memory:${id} -->)`,
    'g'
  );

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const original = fs.readFileSync(filePath, 'utf8');
    const date = new Date().toISOString().split('T')[0];
    const updated = original.replace(pattern, `$1\n## ${date}\n${newContent}\n---\n$2`);
    if (updated !== original) {
      fs.writeFileSync(filePath, updated, 'utf8');
      return;
    }
  }
}
