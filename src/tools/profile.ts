import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { getAllMemories, normalizeProject } from '../db/client';
import { deserializeEmbedding, cosineSimilarity, isModelCompatible, OPENAI_CHAT_MODEL } from '../embeddings/openai';
import { getToolContext } from './context';

// Constants
const MAX_SCORE_PER_PROJECT = 5.0; // Prevent linear boilerplate template score inflation

interface ProfileInput {
  dry_run?: boolean;
  exclude_projects?: string[];
}

// Allowed technologies mapping (allowlist of real skills)
const TECH_CATEGORIES: Record<string, string[]> = {
  "Linguagens": [
    "python", "javascript", "typescript", "go", "rust", "solidity", "html", "css"
  ],
  "Frameworks, UI & Desktop": [
    "fastapi", "express", "react", "electron", "tkinter", "puppeteer", "playwright",
    "lancedb", "pydantic", "ffmpeg", "streamlink", "nextjs", "tailwind", "vite", "framer-motion", "yt-dlp"
  ],
  "Arquitetura, MCP & Bancos de Dados": [
    "sqlite", "postgresql", "indexeddb", "mcp", "rag", "supabase", "git", "vercel", "docker", "vaultmax", "tree-sitter", "zod", "openai"
  ],
  "Especialidades & Domínios": [
    "automation", "scraping", "evasion", "smart-contracts", "licensing-security", "anti-piracy",
    "anti-kasada", "twitch-bypass", "viewer-bot", "hwid-lock", "multi-proxy", "network-concurrency", "ast", "chrome"
  ]
};

// Aliases normalization map
const TAG_ALIASES: Record<string, string> = {
  "reactjs": "react",
  "expressjs": "express",
  "oi177api": "oi177",
  "localstorage": "indexeddb",
  "remix": "solidity",
  "automacao": "automation",
  "evasao": "evasion",
  "seguranca": "licensing-security"
};

// Flat set of allowed tech keys for O(1) checks
const ALLOWED_TECHS = new Set<string>();
for (const list of Object.values(TECH_CATEGORIES)) {
  for (const tech of list) {
    ALLOWED_TECHS.add(tech);
  }
}

// Dynamically check for test or setup directories
function isTestOrSetupProject(name: string): boolean {
  const norm = normalizeProject(name);
  return norm.includes('test') || norm.includes('setup') || norm === 'default' || norm === 'global' || norm === '';
}

// Custom dates period formatting (hides 1-day intervals)
function formatPeriod(started: string, touched: string): string {
  const startStr = started.slice(0, 10);
  const touchStr = touched.slice(0, 10);
  if (startStr === touchStr) {
    const d = new Date(startStr.replace(' ', 'T'));
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    // Avoid NaN for invalid dates fallback
    if (isNaN(d.getTime())) return startStr;
    return `${months[d.getMonth()]}/${d.getFullYear()}`;
  }
  return `de \`${startStr}\` até \`${touchStr}\``;
}

export async function buildProfile(input: ProfileInput) {
  const dryRun = input.dry_run ?? false;
  const { vaultPath } = getToolContext('global');

  try {
    const all = getAllMemories();
    if (all.length === 0) {
      return { success: false, error: 'Nenhuma memória encontrada no banco para gerar o perfil.' };
    }

    // 1. Grouping by project and computing project metrics
    const projects: Record<string, {
      decisions: any[];
      lessons: any[];
      errors: any[];
      constraints: any[];
      maps: any[];
      tags: Set<string>;
      started_at: string;
      last_touched: string;
    }> = {};

    const projectTechScores: Record<string, Record<string, number>> = {};
    const skillProjectsUsed: Record<string, Set<string>> = {};
    const skillDecisionsCount: Record<string, number> = {};
    const skillLessonsCount: Record<string, number> = {};
    const skillLastUsed: Record<string, string> = {};

    const now = new Date();

    for (const m of all) {
      const normProj = normalizeProject(m.project);
      
      // Filter out test or setup projects
      if (isTestOrSetupProject(normProj)) continue;
      
      // Filter manually excluded projects
      if (input.exclude_projects && input.exclude_projects.map(p => normalizeProject(p)).includes(normProj)) {
        continue;
      }

      if (!projects[m.project]) {
        projects[m.project] = {
          decisions: [],
          lessons: [],
          errors: [],
          constraints: [],
          maps: [],
          tags: new Set<string>(),
          started_at: m.created_at,
          last_touched: m.created_at,
        };
      }

      if (m.created_at < projects[m.project].started_at) {
        projects[m.project].started_at = m.created_at;
      }
      if (m.created_at > projects[m.project].last_touched) {
        projects[m.project].last_touched = m.created_at;
      }

      const tagsArray = m.tags;

      // Extract skills
      for (const t of tagsArray) {
        let tagClean = t.toLowerCase().trim();
        if (TAG_ALIASES[tagClean]) tagClean = TAG_ALIASES[tagClean];

        if (ALLOWED_TECHS.has(tagClean)) {
          projects[m.project].tags.add(tagClean);
        }
      }

      // Add to type groups
      if (m.type === 'decision') projects[m.project].decisions.push(m);
      else if (m.type === 'lesson') projects[m.project].lessons.push(m);
      else if (m.type === 'error') projects[m.project].errors.push(m);
      else if (m.type === 'constraint') projects[m.project].constraints.push(m);
      else if (m.type === 'map') projects[m.project].maps.push(m);

      // Score calculation per memory
      const isoDateString = m.created_at.replace(' ', 'T');
      const mDate = new Date(isoDateString);
      const diffTime = Math.abs(now.getTime() - mDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
      const decay = Math.exp(-diffDays / 260);

      let baseWeight = 1.0;
      if (m.type === 'decision') baseWeight = 2.5;
      if (m.type === 'lesson') baseWeight = 1.8;
      if (m.type === 'constraint') baseWeight = 1.2;

      const impWeight = m.importance / 3.0;
      const memoryScore = baseWeight * impWeight * decay;

      for (const t of tagsArray) {
        let tagClean = t.toLowerCase().trim();
        if (TAG_ALIASES[tagClean]) tagClean = TAG_ALIASES[tagClean];

        if (!ALLOWED_TECHS.has(tagClean)) continue;

        if (!projectTechScores[m.project]) {
          projectTechScores[m.project] = {};
        }

        projectTechScores[m.project][tagClean] = (projectTechScores[m.project][tagClean] || 0) + memoryScore;

        if (!skillProjectsUsed[tagClean]) skillProjectsUsed[tagClean] = new Set<string>();
        skillProjectsUsed[tagClean].add(m.project);

        if (m.type === 'decision') {
          skillDecisionsCount[tagClean] = (skillDecisionsCount[tagClean] || 0) + 1;
        }
        if (m.type === 'lesson') {
          skillLessonsCount[tagClean] = (skillLessonsCount[tagClean] || 0) + 1;
        }

        if (!skillLastUsed[tagClean] || m.created_at > skillLastUsed[tagClean]) {
          skillLastUsed[tagClean] = m.created_at;
        }
      }
    }

    // 2. Calculate Final Scores with Project Capping and Logarithmic Scaling
    const finalScores: Record<string, number> = {};
    for (const tag of ALLOWED_TECHS) {
      let sumCapped = 0;
      let usedInAny = false;

      for (const proj of Object.keys(projects)) {
        if (projectTechScores[proj] && projectTechScores[proj][tag]) {
          const scoreInProj = projectTechScores[proj][tag];
          sumCapped += Math.min(scoreInProj, MAX_SCORE_PER_PROJECT);
          usedInAny = true;
        }
      }

      if (usedInAny) {
        const distinctProjects = skillProjectsUsed[tag]?.size || 1;
        // skillScore = Sum(cappedProjectScores) * ln(1 + distinctProjectsUsed)
        finalScores[tag] = sumCapped * Math.log(1 + distinctProjects);
      }
    }

    const sortedSkills = Object.keys(finalScores)
      .map((tag) => ({
        tag,
        name: tag,
        score: finalScores[tag],
        decisionsCount: skillDecisionsCount[tag] || 0,
        lessonsCount: skillLessonsCount[tag] || 0,
        projectsUsed: skillProjectsUsed[tag] || new Set<string>(),
        lastUsed: skillLastUsed[tag] || '',
      }))
      .sort((a, b) => b.score - a.score);

    const totalSkills = sortedSkills.length;

    // Relative ranking with absolute evidence floor
    const skillsWithTiers = sortedSkills.map((s, idx) => {
      const inTop20 = idx < Math.ceil(totalSkills * 0.20);
      const inTop50 = idx < Math.ceil(totalSkills * 0.50);
      const P = s.projectsUsed.size;
      const S = s.score;

      let tier: 'Expert / Lead 🧠' | 'Proficiente ⭐' | 'Competente 🛠️' | 'Conhecimento Prático 🔍' = 'Conhecimento Prático 🔍';

      if (inTop20 && P >= 2 && S >= 4.0) {
        tier = 'Expert / Lead 🧠';
      } else if (inTop50 && S >= 2.0) {
        tier = 'Proficiente ⭐';
      } else if (S >= 0.8) {
        tier = 'Competente 🛠️';
      }

      return {
        ...s,
        tier,
      };
    });

    // 3. Highlight Extraction (Regex based for achievements)
    const ACHIEVE_REGEX = /(\b\d+%\b|\bR\$\s*\d+|\$\s*\d+|\bbypass\b|\breduz\b|\botimiz|\bpercent|\bperformance\b)/i;
    const candidates: string[] = [];
    
    for (const m of all) {
      const normP = normalizeProject(m.project);
      if (isTestOrSetupProject(normP)) continue;
      if (input.exclude_projects && input.exclude_projects.map(p => normalizeProject(p)).includes(normP)) {
        continue;
      }
      
      if (m.type === 'decision' || m.type === 'lesson') {
        if (ACHIEVE_REGEX.test(m.content)) {
          candidates.push(`- [${m.project.toUpperCase()}] ${m.content}`);
        }
      }
    }

    // 4. Híbrido Narrative & Summary (IA + Fallback)
    const apiKey = process.env.OPENAI_API_KEY;
    const isKeyValid = apiKey && apiKey.startsWith('sk-') && !apiKey.includes('INSIRA_SUA_CHAVE_OPENAI_AQUI');

    let headline = '';
    let narrativeSummary = '';
    let aiAchievements: string[] = [];

    if (isKeyValid) {
      const topSkillsList = skillsWithTiers.slice(0, 8).map(s => `${s.name} (${s.tier})`).join(', ');
      const projectsSummary = Object.entries(projects).map(([name, data]) => {
        return `- ${name.toUpperCase()} (evidências: ${data.decisions.length + data.lessons.length}): ${Array.from(data.tags).join(', ')}`;
      }).join('\n');

      try {
        const openai = new OpenAI({ apiKey });
        const completion = await openai.chat.completions.create({
          model: OPENAI_CHAT_MODEL,
          messages: [
            {
              role: 'system',
              content: `Você é um redator profissional especializado em portfólios técnicos e currículos sênior de engenharia de software. 
Seu trabalho é gerar dois blocos narrativos de alto impacto baseados nas competências do usuário.

Bloco 1 (Resumo Executivo): 
Um headline de impacto profissional (1 linha) seguido por um posicionamento de carreira curto, dinâmico e denso (2 a 3 linhas). Evite clichês vazios ("desenvolvedor motivado", "apaixonado por desafios"). Foque no que o usuário de fato construiu: automações complexas, infraestrutura, bots escaláveis, evasão de proteções e Web3. Use tom pragmático e sênior.

Bloco 2 (Principais Conquistas Técnicas):
Reescreva os candidatos a conquistas enviados em 3 a 4 marcadores (bullet points) de conquistas técnicas de alto impacto orientadas a métricas e valor técnico real. Se não houver candidatos suficientes, crie conquistas baseadas nas tags e decisões enviadas (como a redução de recursos via player da twitch ou proteção de builds via HWID locks no Supabase).

Responda estritamente em formato JSON com esta estrutura (sem markdown no bloco de código, sem tags de json, apenas a string json crua):
{
  "headline": "...",
  "summary": "...",
  "achievements": [
    "...",
    "...",
    "..."
  ]
}`
            },
            {
              role: 'user',
              content: `Top Competências: ${topSkillsList}\n\nProjetos Realizados:\n${projectsSummary}\n\nCandidatos a Conquistas:\n${candidates.slice(0, 15).join('\n')}`
            }
          ],
          temperature: 0.3,
          max_tokens: 1000
        });

        const resText = completion.choices[0].message.content?.trim() || '{}';
        const cleanJson = resText.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
        const parsed = JSON.parse(cleanJson);
        
        headline = parsed.headline || '';
        narrativeSummary = parsed.summary || '';
        if (parsed.achievements && parsed.achievements.length > 0) {
          aiAchievements = parsed.achievements;
        }
      } catch (err) {
        console.warn('OpenAI generation failed, falling back to static template:', err);
      }
    }

    // Fallbacks
    if (!narrativeSummary) {
      const top3 = skillsWithTiers.slice(0, 3).map(s => s.name.toUpperCase()).join(', ');
      headline = `Especialista em Engenharia de Software | ${top3}`;
      narrativeSummary = `Profissional de tecnologia focado em engenharia de sistemas e soluções de backend, com sólida proficiência técnica em ${top3}. Histórico consistente de decisões estruturais e resoluções de problemas complexos documentadas através de ${Object.keys(projects).length} projetos de engenharia.`;
    }

    if (aiAchievements.length === 0) {
      const topCandidates = candidates.slice(0, 4);
      for (const cand of topCandidates) {
        const cleaned = cand.replace(/^- \[[^\]]+\]\s*/, '').trim();
        aiAchievements.push(`Compilou decisão técnica de impacto: ${cleaned}`);
      }
      if (aiAchievements.length === 0) {
        aiAchievements.push("Mapeou arquitetura e tomou decisões de design técnico em múltiplos projetos de backend.");
      }
    }

    // 5. Generate Markdown Profile
    let md = `# 🧠 Meu Perfil Profissional Vivo — VaultMAX\n\n`;
    md += `*Este perfil foi compilado automaticamente e localmente em **${new Date().toLocaleDateString('pt-BR')}** com base nas evidências reais do seu trabalho, decisões arquiteturais e lições de bugs solucionados no VaultMAX.*\n\n`;
    md += `---\n\n`;

    md += `## 🚀 ${headline}\n\n`;
    md += `${narrativeSummary}\n\n`;

    md += `### 🏆 Principais Conquistas Técnicas & Impacto\n\n`;
    for (const ach of aiAchievements) {
      md += `- ${ach}\n`;
    }
    md += `\n`;

    md += `---\n\n`;

    md += `## 🛠️ Competências & Proficiências por Categoria\n\n`;
    md += `*Proficiência calculada dinamicamente com base em decisões tomadas por projeto, abrangência de uso e recência de atividade.*\n\n`;

    for (const [category, list] of Object.entries(TECH_CATEGORIES)) {
      const categorySkills = skillsWithTiers.filter(s => list.includes(s.tag));
      if (categorySkills.length === 0) continue;

      md += `### 🔹 ${category}\n\n`;
      md += `| Competência | Proficiência | Score Real | Decisões | Lições | Projetos | Último Uso |\n`;
      md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
      for (const s of categorySkills) {
        const lastDate = s.lastUsed.slice(0, 10);
        const projs = Array.from(s.projectsUsed).map((p) => p.toUpperCase()).join(', ');
        md += `| **${s.name}** | \`${s.tier}\` | \`${s.score.toFixed(2)}\` | \`${s.decisionsCount}\` | \`${s.lessonsCount}\` | *${projs}* | \`${lastDate}\` |\n`;
      }
      md += `\n`;
    }

    md += `---\n\n`;
    md += `## 📁 Portfólio de Projetos & Conquistas\n\n`;

    for (const [proj, data] of Object.entries(projects)) {
      const period = formatPeriod(data.started_at, data.last_touched);
      md += `### 🔹 Projeto: ${proj.toUpperCase()}\n`;
      md += `- **Período de Atividade:** ${period}\n`;
      const stack = Array.from(data.tags).map((t) => `\`${t}\``).join(', ');
      md += `- **Tecnologias Utilizadas:** ${stack || '*Nenhuma tag registrada*'}\n`;
      md += `- **Total de Evidências:** \`${data.decisions.length + data.lessons.length + data.errors.length + data.constraints.length}\` itens gravados.\n\n`;

      if (data.decisions.length > 0) {
        md += `#### 🏛️ Decisões Arquiteturais Relevantes\n`;
        const topDecisions = [...data.decisions]
          .sort((a, b) => b.importance - a.importance || b.created_at.localeCompare(a.created_at))
          .slice(0, 5);
        for (const dec of topDecisions) {
          const impStar = '⭐'.repeat(dec.importance);
          md += `- **[${dec.created_at.slice(0, 10)}]** (${impStar}) ${dec.content}\n`;
        }
        md += `\n`;
      }

      if (data.lessons.length > 0) {
        md += `#### 🎓 Lições Aprendidas & Engenharia Reversa de Erros\n`;
        const topLessons = [...data.lessons]
          .sort((a, b) => b.importance - a.importance || b.created_at.localeCompare(a.created_at))
          .slice(0, 5);
        for (const les of topLessons) {
          const impStar = '⭐'.repeat(les.importance);
          md += `- **[${les.created_at.slice(0, 10)}]** (${impStar}) ${les.content}\n`;
        }
        md += `\n`;
      }

      if (data.constraints.length > 0) {
        md += `#### ⚠️ Regras & Restrições Invioláveis\n`;
        for (const con of data.constraints) {
          md += `- **[${con.created_at.slice(0, 10)}]** ${con.content}\n`;
        }
        md += `\n`;
      }

      md += `\n`;
    }

    if (!dryRun) {
      fs.mkdirSync(vaultPath, { recursive: true });
      const profilePath = path.join(vaultPath, 'profile.md');
      fs.writeFileSync(profilePath, md, 'utf8');
    }

    return {
      success: true,
      dry_run: dryRun,
      skills_counted: sortedSkills.length,
      projects_indexed: Object.keys(projects).length,
      profile_markdown: md,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
