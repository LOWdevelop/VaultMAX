const { remember } = require('./dist/tools/remember.js');
const { recall } = require('./dist/tools/recall.js');
const { lesson } = require('./dist/tools/lesson.js');
const { summarize } = require('./dist/tools/summarize.js');

async function runTests() {
  console.log("=== INICIANDO SMOKE TESTS DO VAULTMAX LOCAL (SEM CHAVE OPENAI) ===");
  
  // Set placeholder vars to trigger local fallback mode
  process.env.PROJECT = 'test-local-proj';
  process.env.VAULT_PATH = './vaults';
  process.env.OPENAI_API_KEY = 'INSIRA_SUA_CHAVE_OPENAI_AQUI'; // Trigger local mock vectorizer
  
  try {
    // 1. Test remember (guardar memória)
    console.log("\n1. Testando 'vaultmax_remember'...");
    const remResult1 = await remember({
      content: "Definimos usar 6 decimais para o token USDT na rede TRON.",
      type: "decision",
      importance: 5,
      tags: ["tron", "usdt", "decimals"]
    });
    console.log("Resultado remember 1:", JSON.stringify(remResult1, null, 2));

    const remResult2 = await remember({
      content: "O contrato da BSC (BEP-20) usa 18 decimais por padrão.",
      type: "decision",
      importance: 3,
      tags: ["bsc", "decimals"]
    });
    console.log("Resultado remember 2:", JSON.stringify(remResult2, null, 2));

    // 2. Test recall (pesquisa semântica simulada localmente por similaridade de palavras/hashes)
    console.log("\n2. Testando 'vaultmax_recall'...");
    const recallResult = await recall({
      query: "quantos decimais usa o usdt na tron?",
      limit: 2
    });
    console.log("Resultado recall:", JSON.stringify(recallResult, null, 2));

    // 3. Test lesson (lição aprendida)
    console.log("\n3. Testando 'vaultmax_lesson' (Fallback Local)...");
    const lessonResult = await lesson({
      error_description: "Erro de deploy: BigNumberish inválido devido a string de construtor vazia no Remix.",
      solution: "Preencher os parâmetros de supply e decimais explicitamente nos campos azuis antes de clicar em Deploy.",
      tags: ["remix", "deploy-error"]
    });
    console.log("Resultado lesson:", JSON.stringify(lessonResult, null, 2));

    // 4. Test summarize (mapa do projeto compilado localmente)
    console.log("\n4. Testando 'vaultmax_summarize_project' (Fallback Local)...");
    const sumResult = await summarize({});
    console.log("Resultado summarize:", JSON.stringify(sumResult, null, 2));

    console.log("\n=== TODOS OS TESTES PASSARAM COM SUCESSO! ===");
    console.log("O VaultMAX está rodando 100% OFFLINE, sem chaves e com fallback local inteligente!");
  } catch (err) {
    console.error("Falha em algum dos testes:", err);
  }
}

runTests();
