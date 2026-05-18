# VaultMAX — Active Memory (v2)

You have access to VaultMAX, a persistent memory system for this project.
Use it in EVERY interaction without exception.

## BEFORE any task (mandatory — one call)
Call `vaultmax_brief` with a brief description of what you're about to do.
This returns in a single shot:
- **constraints** — inviolable rules you MUST follow
- **map** — current project state
- **recent decisions** — what was decided lately
- **recent lessons** — preventive rules from past errors
- **relevant memories** — semantically matched to your task

Never start coding without consulting `vaultmax_brief` first — not even for "simple" tasks.

## How to USE the brief result (mandatory)
After receiving the brief:
1. If `constraints` is non-empty → explicitly acknowledge them in your reply BEFORE proposing any code. Example: *"Following the constraint that Flask must run on :5678, I'll..."*
2. If `recent_lessons` matches the current task → state the lesson and how you'll apply it
3. If `relevant_memories` shows a past attempt → reference it (*"Memory abc1234 already addressed this with X — I'll build on that"*)
4. If `map` is empty/null → your FIRST action must be to create one (type `map`)

Silently ignoring the brief is the worst failure mode.

## DURING a task
- If you find a decision already made → respect it; only change with explicit user consent
- If you hit unexpected behavior → call `vaultmax_recall("similar problem")` before debugging from scratch
- Never reimplement something without checking if it was already tried

## AFTER any task (mandatory)
Save what was done with `vaultmax_remember`:
- File/function/approximate line of what changed
- Why it was done that way (decision rationale)
- What was discarded and why (if applicable)
- If project structure changed → save as type "map"
- If you resolved a bug → BOTH save type "error" AND call `vaultmax_lesson` to generate the preventive rule

## How to pick the memory type (decision tree)

Ask yourself in this exact order — stop at the first YES:

1. **Is this a rule that must NEVER be violated, regardless of context?**
   → `constraint` (e.g., "API key never logged", "Flask must run on :5678")

2. **Did I just fix a non-trivial bug whose cause+fix would help future tasks?**
   → call `vaultmax_lesson(error, solution)` — DO NOT use `remember` with type `error` alone

3. **Is this a real bug I encountered (without a generalizable rule yet)?**
   → `error` (root cause + solution, no AI-generated rule)

4. **Is this an architectural choice that could change later if requirements change?**
   → `decision` (library picked, pattern adopted, port chosen)

5. **Did the project structure / file layout change?**
   → `map` (or trigger `vaultmax_summarize_project` if 10+ memories accumulated since last map)

6. **None of the above — it's just a log of "what I did today"?**
   → `change` (use sparingly — most things fit a better type above)

## Periodic maintenance (gatilho explícito)

Keep an internal counter of how many `vaultmax_remember` calls you have made this session.
- **Every 10 `remember` calls** → call `vaultmax_summarize_project()` to refresh the map
- **At the end of a long session (50+ exchanges)** → call `vaultmax_summarize_project()` once before stopping

This is not optional. A stale map degrades every future `brief`.

## Special tools

- **`vaultmax_lesson(error, solution)`** — preferred over `remember type=error` after fixing bugs. Generates a preventive rule. Future tasks see it in `vaultmax_brief`.
- **`vaultmax_summarize_project()`** — regenerates the project map from all memories. Triggers above.
- **`vaultmax_remember` with `importance: 5`** — escalates a memory to top priority in semantic search. Use for critical patterns. Default importance is 3.

## Absolute rules

- NEVER end a task without saving to the vault
- NEVER repeat an error already recorded as a `lesson`
- NEVER violate a `constraint` — and always acknowledge constraints explicitly when they apply
- NEVER explore the project without `vaultmax_brief` first
- NEVER silently ignore the brief result — always reference relevant items in your reply
- If the vault is empty: after first task, create the project map (`type: "map"`) AND register any obvious constraints
- Duplicate memories (>92% similar) are auto-rejected — don't worry about saving the same thing twice
