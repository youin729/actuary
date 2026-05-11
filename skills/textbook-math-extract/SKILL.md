# Textbook Math Extract

## Purpose

教科書・問題集の数学問題画像を読み取り、スマートフォン学習アプリで使いやすいJSONメタデータに変換する。

## When to Use

- 数学教科書、問題集、プリント、板書などの問題画像をJSON化するとき
- スマホ学習アプリ向けに、問題本文・条件・入力形式・解法ステップ・ヒント・UI部品を分離するとき
- 数式をLaTeXとして保持し、アプリ側で再レンダリングしたいとき

## Input

- 数学問題が写った画像ファイル
- 任意の補足情報: 出典、ページ、問題番号、科目、単元、対象学年

## Output

必ず `schema.json` に準拠したJSONのみを出力する。説明文、Markdown、コードブロックは出力しない。

## Extraction Rules

1. 画像内の問題文を読み取る。
2. 問題を以下に分解する。
   - original_text
   - subject
   - unit
   - problem_type
   - difficulty
   - givens
   - question
   - answer_format
   - steps
   - final_answer
   - hints
   - ui_components
3. 数式はLaTeX形式で保持する。
4. 不明な値は推測しすぎず、スキーマが `null` を許す項目は `null` にする。必須の文字列項目では `"unknown"` を使う。
5. 解答が画像内にない場合、`final_answer` は推論してよい。ただし推論解答であることを前提に `confidence` を下げる。
6. スマホUIで解きやすいように、`steps` は1操作1ステップに分解する。
7. 入力形式は次のいずれかに分類する。
   - choice
   - fill_blank
   - numeric
   - formula
   - reorder
   - graph
   - free_text
8. 著作権保護のため、`original_text` は必要最小限にし、全文転載が不要な場合は要約する。
9. `question` は学習者に表示できる短い問いに整える。
10. `givens` は数値・条件・図形情報など、解答に必要なものだけを抽出する。

## Problem Types

- calculation
- equation
- inequality
- function
- geometry
- probability
- statistics
- word_problem
- proof
- other

## UI Component Rules

問題ごとにスマホ用UI部品を提案する。UI部品名は短い snake_case の文字列にする。

例:

- problem_card
- formula_picker
- blank_inputs
- step_by_step_solver
- multiple_choice
- number_keypad
- math_keyboard
- diagram_view
- hint_panel

## Quality Checks

出力前に以下を確認する。

- JSONとしてvalidである
- `schema.json` に準拠している
- `steps` が空ではない
- `answer_format` がUI入力可能な形式である
- `final_answer` がある場合、`steps` と矛盾していない
- `original_text` が過度な転載になっていない
- 画像内に解答がない推論解答では `confidence <= 0.75` を目安にする
- 画像だけでは科目・単元が判断できない場合、`subject` や `unit` は `null` にする

## Local Commands

```bash
python3 skills/textbook-math-extract/scripts/extract_from_image.py path/to/image.png output.json
python3 skills/textbook-math-extract/scripts/extract_from_image.py path/to/images output-json-dir --recursive
python3 skills/textbook-math-extract/scripts/validate_json.py output.json
```
