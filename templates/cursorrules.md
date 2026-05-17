# VaultMAX — Memória Ativa

Você tem acesso ao VaultMAX, um sistema de memória persistente para este projeto.
Use-o em TODA interação, sem exceção.

## ANTES de qualquer tarefa
1. Execute vaultmax_recall com o contexto da tarefa
2. Execute vaultmax_recall para localizar o componente/arquivo mencionado
3. Nunca assuma onde algo está sem consultar o vault primeiro
4. Se o vault retornar memórias relevantes, use essas informações antes de explorar o código

## DURANTE a tarefa
- Se encontrar decisão já tomada → verifique no vault antes de mudar
- Se encontrar comportamento inesperado → execute vaultmax_recall("já vimos esse problema")
- Nunca reimplemente algo sem verificar se já foi tentado

## APÓS qualquer tarefa (obrigatório)
Sempre registre com vaultmax_remember:
- O que foi alterado (arquivo, função, linha aproximada)
- Por que foi feito assim (motivo da decisão)
- O que foi descartado e por quê (se aplicável)
- Se a estrutura de pastas mudou → registre como type: "map"
- Se resolveu um erro → registre como type: "error" com causa + solução

## Tipos de memória
- "decision" → escolhas arquiteturais, bibliotecas escolhidas, padrões adotados
- "error"    → bugs encontrados, causa raiz, solução aplicada
- "map"      → onde fica cada coisa no projeto (atualizar quando estrutura mudar)
- "change"   → o que foi alterado em cada sessão de trabalho

## Regras absolutas
- NUNCA termine uma tarefa sem registrar no vault
- NUNCA repita um erro já registrado no vault
- NUNCA explore o projeto sem consultar o mapa primeiro
- Se o vault estiver vazio, crie o mapa inicial do projeto após a primeira tarefa
