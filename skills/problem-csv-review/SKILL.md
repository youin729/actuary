---
name: problem-csv-review
description: Review, edit, and validate this repository's source/problem.csv practice-problem data and generated public/problems JSON. Use when Codex is asked to add practice problems, revise Japanese problem wording, check problem quality, sync problem data, or review source/problem.csv against source/fomula.csv.
---

# Problem CSV Review

## Overview

Use this skill when working on `source/problem.csv` or generated problem data. Preserve mathematical correctness while making each problem readable as a standalone mobile-app prompt.

## Workflow

1. Inspect `source/problem.csv` headers and representative rows before editing.
2. If formula linkage matters, compare `対象ID` and `公式名` against `source/fomula.csv`.
3. Edit only the needed CSV fields. Keep `問題ID`, `対象ID`, `公式名`, `数式（LaTeX）`, and `解答` stable unless the task requires changing them.
4. After editing, run `npm run sync:problems`.
5. If the static app should reflect changes, run `npm run build`.
6. Validate row count, column count, duplicate IDs, and missing formula IDs.

## Japanese Wording Standards

Write every problem so it works without surrounding context.

- Avoid terse notation-only prompts such as `X=0(0.4),5(0.6)。E[X]は？`.
- State the object being modeled: `確率変数 X`, `事象 A, B`, `観測値`, `年金`, `遷移確率行列`など。
- State the assumptions before the requested quantity.
- End with a natural request such as `期待値 E[X] を求めてください。`, `分散 Var(X) を求めてください。`, or `P(A|B) を求めてください。`.
- Use `求めてください。` or `確認してください。` rather than mixing `求めよ。` and `は？`.
- For probabilities, use clear language such as `X=0 となる確率が 0.4（40%）` when it improves readability.
- Do not use `同上`, `上と同じ`, `P=各0.5`, or other expressions that depend on prior rows.

## Rewrite Patterns

Use these patterns as defaults, adapting nouns to the problem domain.

- `100円が0.2、0円が0.8。期待値は？`
  -> `あるくじ引きは100円の当選確率が 0.2（20%）、はずれ（0円）の確率が 0.8（80%） です。賞金額の期待値を求めてください。`
- `X=0(0.4),5(0.6)。E[X]は？`
  -> `確率変数 X は次の値をとります：X=0 となる確率が 0.4（40%）、X=5 となる確率が 0.6（60%） です。期待値 E[X] を求めてください。`
- `P(A)=0.4, P(B)=0.3, P(A∩B)=0.1 のとき P(A∪B) は？`
  -> `事象 A, B について P(A)=0.4, P(B)=0.3, P(A∩B)=0.1 です。P(A∪B) を求めてください。`
- `E[X]=2, E[X^2]=5 のとき Var(X) を求めよ。`
  -> `確率変数 X について E[X]=2, E[X^2]=5 です。分散 Var(X) を求めてください。`

## Content Quality Checks

- `数式（LaTeX）` is shown as the hint in practice mode. Prefer a substituted intermediate expression, not only `E[X]`, `Var(X)`, or `q_x`.
- `解答` is tokenized in the UI. Keep it as a concise final answer; put derivations in `数式（LaTeX）`.
- Problems in the same formula group should vary in use case, not only numbers.
- Avoid many consecutive problems with identical answer forms when a formula can be tested through different situations.
- Keep LaTeX as LaTeX. Do not convert formulas to plain Japanese if the field is mathematical.

## Validation Commands

Run these after material changes:

```bash
npm run sync:problems
npm run build
```

Use a lightweight CSV validation when needed:

```bash
node -e "const fs=require('fs');const rows=fs.readFileSync('source/problem.csv','utf8').trim().split(/\n/);console.log(rows.length-1)"
```
