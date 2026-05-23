import fs from 'fs';
import path from 'path';
import { getAllMemories, normalizeProject } from '../db/client';
import { deserializeEmbedding, cosineSimilarity, isModelCompatible } from '../embeddings/openai';
import { getToolContext } from './context';

interface ProfileInput {
  dry_run?: boolean;
}

export async function buildProfile(input: ProfileInput) {
  const dryRun = input.dry_run ?? false;
  const { vaultPath } = getToolContext('global');

  try {
    const all = getAllMemories();
    const globalProject = normalizeProject('global');
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

    for (const m of all) {
      const proj = m.project;
      const isGlobal = normalizeProject(proj) === globalProject;
      if (!projects[proj]) {
        projects[proj] = {
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

      if (m.created_at < projects[proj].started_at) {
        projects[proj].started_at = m.created_at;
      }
      if (m.created_at > projects[proj].last_touched) {
        projects[proj].last_touched = m.created_at;
      }

      const tagsArray = m.tags;

      for (const t of tagsArray) {
        if (t && t !== 'auto' && t !== 'summary') {
          projects[proj].tags.add(t.toLowerCase());
        }
      }

      if (isGlobal) {
        if (m.type === 'decision') projects[proj].decisions.push(m);
        else if (m.type === 'lesson') projects[proj].lessons.push(m);
        else if (m.type === 'error') projects[proj].errors.push(m);
        else if (m.type === 'constraint') projects[proj].constraints.push(m);
        else if (m.type === 'map') projects[proj].maps.push(m);
      } else if (m.type === 'decision') projects[proj].decisions.push(m);
      else if (m.type === 'lesson') projects[proj].lessons.push(m);
      else if (m.type === 'error') projects[proj].errors.push(m);
      else if (m.type === 'constraint') projects[proj].constraints.push(m);
      else if (m.type === 'map') projects[proj].maps.push(m);
    }

    // 2. Compute Skill Scores (tag counts weighted by importance and recency decay)
    const skillScores: Record<string, {
      name: string;
      score: number;
      decisionsCount: number;
      lessonsCount: number;
      projectsUsed: Set<string>;
      lastUsed: string;
    }> = {};

    const now = new Date();

    for (const m of all) {
      let tagsArray = m.tags;

      // Filter out auto/generic tags
      tagsArray = tagsArray.filter((t) => t && t !== 'auto' && t !== 'summary');

      // Convert SQLite space-separated date to standard ISO format for parsing
      const isoDateString = m.created_at.replace(' ', 'T');
      const mDate = new Date(isoDateString);
      const diffTime = Math.abs(now.getTime() - mDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;

      // Recency decay with half-life ~180 days: exp(-days / 260)
      const decay = Math.exp(-diffDays / 260);

      // Base weight for type
      let baseWeight = 1.0;
      if (m.type === 'decision') baseWeight = 2.5; // decisions indicate structural competence
      if (m.type === 'lesson') baseWeight = 1.8;   // lessons indicate problem-solving ability
      if (m.type === 'constraint') baseWeight = 1.2;

      // Importance weight (1 to 5)
      const impWeight = m.importance / 3.0;

      const memoryScore = baseWeight * impWeight * decay;

      for (const t of tagsArray) {
        const tagClean = t.toLowerCase().trim();
        if (!skillScores[tagClean]) {
          skillScores[tagClean] = {
            name: t,
            score: 0,
            decisionsCount: 0,
            lessonsCount: 0,
            projectsUsed: new Set<string>(),
            lastUsed: m.created_at,
          };
        }

        skillScores[tagClean].score += memoryScore;
        if (m.type === 'decision') skillScores[tagClean].decisionsCount++;
        if (m.type === 'lesson') skillScores[tagClean].lessonsCount++;
        skillScores[tagClean].projectsUsed.add(m.project);
        if (m.created_at > skillScores[tagClean].lastUsed) {
          skillScores[tagClean].lastUsed = m.created_at;
        }
      }
    }

    const sortedSkills = Object.values(skillScores).sort((a, b) => b.score - a.score);

    // --- Chronode Feature Integration: Semantic Learning Promotion Check ---
    const lessons = all.filter((m) => m.type === 'lesson');
    const crossProjectRecurrences: Array<{
      lessonA: typeof lessons[0];
      lessonB: typeof lessons[0];
      similarity: number;
    }> = [];

    for (let i = 0; i < lessons.length; i++) {
      for (let j = i + 1; j < lessons.length; j++) {
        const a = lessons[i];
        const b = lessons[j];
        if (a.project !== b.project && isModelCompatible(a.embedding_model, b.embedding_model)) {
          const sim = cosineSimilarity(
            deserializeEmbedding(a.embedding),
            deserializeEmbedding(b.embedding)
          );
          if (sim >= 0.82) {
            crossProjectRecurrences.push({
              lessonA: a,
              lessonB: b,
              similarity: sim,
            });
          }
        }
      }
    }

    function getTier(score: number): 'Deep 🧠' | 'Proficient ⭐' | 'Competent 🛠️' | 'Exploring 🔍' {
      if (score >= 8) return 'Deep 🧠';
      if (score >= 3.5) return 'Proficient ⭐';
      if (score >= 1.2) return 'Competent 🛠️';
      return 'Exploring 🔍';
    }

    // 3. Generate Markdown Profile
    let md = `# 🧠 Meu Perfil Profissional Vivo — VaultMAX\n\n`;
    md += `*Este perfil foi compilado automaticamente e localmente em **${new Date().toLocaleDateString('pt-BR')}** com base nas evidências reais do seu trabalho, decisões arquiteturais e lições de bugs solucionados no VaultMAX.*\n\n`;
    md += `---\n\n`;

    md += `## 🛠️ Competências & Proficiências\n\n`;
    md += `*Sua senioridade é calculada dinamicamente com base no volume de decisões técnicas tomadas, lições aprendidas em código e um fator de decaimento por tempo de inatividade (recência).*\n\n`;
    
    if (sortedSkills.length === 0) {
      md += `*Nenhuma tag de competência foi detectada nas memórias atuais.*\n\n`;
    } else {
      md += `| Competência | Proficiência | Score Real | Decisões | Lições | Projetos | Último Uso |\n`;
      md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
      for (const s of sortedSkills) {
        const tier = getTier(s.score);
        const lastDate = s.lastUsed.slice(0, 10);
        const projs = Array.from(s.projectsUsed).map((p) => p.toUpperCase()).join(', ');
        md += `| **${s.name}** | \`${tier}\` | \`${s.score.toFixed(2)}\` | \`${s.decisionsCount}\` | \`${s.lessonsCount}\` | *${projs}* | \`${lastDate}\` |\n`;
      }
      md += `\n`;
    }

    md += `---\n\n`;
    md += `## 📁 Portfólio de Projetos & Conquistas\n\n`;

    for (const [proj, data] of Object.entries(projects)) {
      md += `### 🔹 Projeto: ${proj.toUpperCase()}\n`;
      md += `- **Período de Atividade:** de \`${data.started_at.slice(0, 10)}\` até \`${data.last_touched.slice(0, 10)}\`\n`;
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

    md += `---\n\n`;
    md += `## 📅 Timeline Recente de Engenharia\n\n`;
    md += `*Eventos significativos de design, erros superados e lições preventivas consolidadas cronologicamente:*\n\n`;

    const timelineEvents = all
      .filter((m) => m.type === 'decision' || m.type === 'lesson' || m.type === 'constraint')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 15);

    if (timelineEvents.length === 0) {
      md += `*Nenhum evento registrado para a timeline.*\n\n`;
    } else {
      for (const e of timelineEvents) {
        let typeIcon = '🏛️ [Decisão]';
        if (e.type === 'lesson') typeIcon = '🎓 [Lição]';
        if (e.type === 'constraint') typeIcon = '⚠️ [Restrição]';

        md += `- **${e.created_at.slice(0, 10)}** — *${e.project.toUpperCase()}* | **${typeIcon}**: ${e.content}\n`;
      }
      md += `\n`;
    }

    md += `---\n\n`;
    md += `## 💡 Recomendações de Promoção Semântica (Aprendizados Globais)\n\n`;
    md += `*Mapeamento inteligente de lições de bugs e soluções parecidas que ocorreram em múltiplos projetos, sugerindo a promoção a regras universais em \`rules/universal\`:*\n\n`;

    if (crossProjectRecurrences.length === 0) {
      md += `*Nenhuma lição recorrente com alta similaridade semântica (cosseno >= 0.82) foi detectada entre projetos diferentes.*\n\n`;
    } else {
      for (const rec of crossProjectRecurrences) {
        md += `* **[Sugestão de Promoção]** Cosseno de Similaridade Semântica: \`${rec.similarity.toFixed(2)}\`\n`;
        md += `  * **Projetos:** \`${rec.lessonA.project.toUpperCase()}\` e \`${rec.lessonB.project.toUpperCase()}\`\n`;
        md += `  * **Evidências:**\n`;
        md += `    * *[${rec.lessonA.project.toUpperCase()}]:* "${rec.lessonA.content}"\n`;
        md += `    * *[${rec.lessonB.project.toUpperCase()}]:* "${rec.lessonB.content}"\n`;
        md += `  * **Ação:** Execute a promoção com a ferramenta do MCP ou CLI passando os IDs: \`${rec.lessonA.id},${rec.lessonB.id}\`\n\n`;
      }
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
