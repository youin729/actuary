# Codex Instructions

このリポジトリで数学教科書・問題集画像のJSON化に関わる作業を行う場合、常に `skills/textbook-math-extract/SKILL.md` の方針に従う。

必須方針:

- 出力JSONは `skills/textbook-math-extract/schema.json` で検証できる形にする。
- 数式はLaTeXで保持する。
- `original_text` は著作権保護のため必要最小限にする。
- 画像内に解答がない場合、推論した解答は許可するが `confidence` を下げる。
- スマホ学習アプリで使う前提で、`steps`、`hints`、`ui_components` を実用的に分解する。
- スクリプトは `skills/textbook-math-extract/scripts/` 配下を正とする。
