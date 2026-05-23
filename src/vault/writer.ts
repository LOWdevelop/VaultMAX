import fs from 'fs';
import path from 'path';

export type MemoryType = 'decision' | 'error' | 'map' | 'change' | 'lesson' | 'constraint';

const INDEX_FILE: Record<MemoryType, string> = {
  decision: 'decisions.md',
  error: 'changelog.md',
  change: 'changelog.md',
  map: 'map.md',
  lesson: 'lessons.md',
  constraint: 'constraints.md',
};

const INDEX_TITLE: Record<string, string> = {
  'decisions.md': 'Decisions',
  'changelog.md': 'Changelog',
  'map.md': 'Map',
  'lessons.md': 'Lessons',
  'constraints.md': 'Constraints',
};

export interface RelatedMemory {
  id: string;
  content: string;
  score: number;
}

function projectDir(project: string, vaultPath: string): string {
  return path.join(vaultPath, project);
}

function identityDir(identity: string, vaultPath: string): string {
  return path.join(vaultPath, '_profiles', identity);
}

function fileRoot(project: string, vaultPath: string, identity?: string): string {
  return project === identity && identity ? identityDir(identity, vaultPath) : projectDir(project, vaultPath);
}

function memoryFilePath(project: string, id: string, vaultPath: string): string {
  return path.join(projectDir(project, vaultPath), 'memories', `${id}.md`);
}

export function ensureVaultExists(project: string, vaultPath: string, identity?: string): void {
  const pd = fileRoot(project, vaultPath, identity);
  fs.mkdirSync(pd, { recursive: true });
  fs.mkdirSync(path.join(pd, 'memories'), { recursive: true });

  // Auto-generate .gitignore so Obsidian local state never gets committed
  const gitignorePath = path.join(pd, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '.obsidian/\n', 'utf8');
  }

  for (const [file, title] of Object.entries(INDEX_TITLE)) {
    const filePath = path.join(pd, file);
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
  tags: string[],
  importance: number,
  related: RelatedMemory[],
  vaultPath: string,
  identity?: string
): void {
  ensureVaultExists(project, vaultPath, identity);

  const now = new Date();
  const timestamp = now.toISOString().slice(0, 19).replace('T', ' ');
  const date = timestamp.slice(0, 10);

  const relatedSection =
    related.length > 0
      ? `\n## Related\n${related
          .map((r) => `- [[${r.id}]] (${r.score.toFixed(2)}) — ${r.content.slice(0, 60)}...`)
          .join('\n')}\n`
      : '';

  const memFile =
    `---\n` +
    `id: ${id}\n` +
    `type: ${type}\n` +
    `project: ${project}\n` +
    `created: ${timestamp}\n` +
    `importance: ${importance}\n` +
    `tags: [${tags.join(', ')}]\n` +
    `---\n\n` +
    `${content}\n${relatedSection}`;

  fs.writeFileSync(
    memoryFilePath(project, id, vaultPath),
    memFile,
    'utf8'
  );

  for (const rel of related) {
    addBacklink(project, rel.id, id, rel.score, content, vaultPath);
  }

  const indexPath = path.join(fileRoot(project, vaultPath, identity), INDEX_FILE[type]);
  const tagStr = tags.length > 0 ? ` — \`${tags.join('`, `')}\`` : '';
  const impMarker = importance >= 4 ? ' ⭐' : '';
  fs.appendFileSync(indexPath, `- [[${id}]] · ${date}${impMarker}${tagStr}\n`, 'utf8');
}

function addBacklink(
  project: string,
  existingId: string,
  newId: string,
  score: number,
  newContent: string,
  vaultPath: string
): void {
  const filePath = memoryFilePath(project, existingId, vaultPath);
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, 'utf8');
  const link = `- [[${newId}]] (${score.toFixed(2)}) — ${newContent.slice(0, 60)}...`;

  if (content.includes('## Related\n')) {
    content = content.replace('## Related\n', `## Related\n${link}\n`);
  } else {
    content += `\n## Related\n${link}\n`;
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

export function removeFromVault(project: string, id: string, vaultPath: string): void {
  const filePath = memoryFilePath(project, id, vaultPath);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  const indexes = ['decisions.md', 'changelog.md', 'map.md', 'lessons.md', 'constraints.md'].map(
    (f) => path.join(projectDir(project, vaultPath), f)
  );
  for (const indexPath of indexes) {
    if (!fs.existsSync(indexPath)) continue;
    const lines = fs.readFileSync(indexPath, 'utf8').split('\n');
    const filtered = lines.filter((l) => !l.includes(`[[${id}]]`));
    if (filtered.length !== lines.length) {
      fs.writeFileSync(indexPath, filtered.join('\n'), 'utf8');
    }
  }
}

export function updateInVault(
  project: string,
  id: string,
  newContent: string,
  vaultPath: string
): void {
  const filePath = memoryFilePath(project, id, vaultPath);
  if (!fs.existsSync(filePath)) return;

  let file = fs.readFileSync(filePath, 'utf8');
  const frontmatterEnd = file.indexOf('---', 3) + 3;
  const relatedStart = file.indexOf('\n## Related');
  const suffix = relatedStart !== -1 ? file.slice(relatedStart) : '';
  file = file.slice(0, frontmatterEnd) + `\n\n${newContent}\n` + suffix;
  fs.writeFileSync(filePath, file, 'utf8');
}
