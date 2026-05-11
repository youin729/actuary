# Textbook Math Extract

数学教科書・問題集の問題画像を、スマホ学習アプリ向けのJSONメタデータに変換するPythonプロジェクトです。

## セットアップ

```bash
cd /Users/HiromasaKasamatsu/actuary
python3 -m venv .venv
source .venv/bin/activate
pip install -r skills/textbook-math-extract/requirements.txt
cp skills/textbook-math-extract/.env.example .env
```

`.env` または環境変数で `OPENAI_API_KEY` を設定してください。変数名は `OPENAI_API_KEY` です。`OPEN_API_KEY` ではありません。

```bash
export OPENAI_API_KEY="sk-..."
```

`.env` はリポジトリ直下、または `skills/textbook-math-extract/.env` に置けます。`.env.example` の `sk-your-real-api-key` はサンプルなので、実際のAPIキーに置き換えてください。

認証エラーが出る場合は、次を確認してください。

```bash
grep -h '^OPENAI_API_KEY=' .env skills/textbook-math-extract/.env 2>/dev/null | sed 's/=.*/=<set>/'
```

## 画像からJSONを作成

```bash
python3 skills/textbook-math-extract/scripts/extract_from_image.py \
  path/to/problem.png \
  output/problem.json \
  --subject "数学I" \
  --unit "二次方程式" \
  --page 12 \
  --problem-number "3"
```

処理中は、画像スキャン、解答画像の対応付け、画像エンコード、OpenAI API送信、JSON検証、保存完了などの途中経過が標準エラーに表示されます。

主なオプション:

- `--model`: 使用するOpenAIモデル。未指定時は `OPENAI_MODEL`、それも未設定なら `gpt-5-nano`
- `--problem-id`: `id` を手動指定。未指定時は画像内容から安定IDを生成
- `--subject`, `--unit`: 画像だけでは判定しづらい科目・単元のヒント
- `--page`, `--problem-number`: 出典メタデータ
- `--answer-image`: 1枚の問題画像に対応する解答画像。`final_answer`、`steps`、`confidence` の精度向上に使います
- `--answer-dir`: 入力画像と同じファイル名の解答画像を置いたディレクトリ

1枚の画像に複数の小問がある場合は、小問ごとに別々のJSONを出力します。たとえば `input/1.jpg` に小問1〜5がある場合、出力先には `1_1.json`、`1_2.json` のように単一 problem JSONが作られます。各JSONは個別に `schema.json` で検証できます。

解答画像を使う例:

```bash
python3 skills/textbook-math-extract/scripts/extract_from_image.py \
  input/1.jpg \
  output/1.json \
  --answer-image input/answer/1.png
```

## 複数画像を一括処理

入力にディレクトリを指定すると、その直下の対応画像をまとめて処理します。再帰的に読む場合は `--recursive` を付けます。

```bash
python3 skills/textbook-math-extract/scripts/extract_from_image.py \
  path/to/images \
  output/json \
  --recursive \
  --subject "数学I"
```

解答画像を `input/answer/1.png` のように置いている場合は、`--answer-dir` を指定します。`--recursive` で `input` を読むときも、指定した解答ディレクトリ内の画像は問題画像として処理しません。

```bash
python3 skills/textbook-math-extract/scripts/extract_from_image.py \
  input \
  output/json \
  --recursive \
  --answer-dir input/answer
```

対応画像形式は `.png`, `.jpg`, `.jpeg`, `.webp` です。出力先には入力画像と同じ相対パスで `.json` が作成されます。

## JSONを検証

```bash
python3 skills/textbook-math-extract/scripts/validate_json.py output/problem.json
```

検証スキーマは `skills/textbook-math-extract/schema.json` です。サンプルは `skills/textbook-math-extract/examples/sample_metadata.json` にあります。

## 抽出方針

- 数式はLaTeXで保持します。
- `original_text` は著作権保護のため、必要最小限の抜粋または要約にします。
- 画像内に解答がない場合は、推論可能な範囲で `final_answer` を補い、`confidence` を低めにします。
- スマホUIで扱いやすいように、`steps` は1操作1ステップを目安に分割します。

## スマートフォン向けUI

GitHub Pages に配置できる演習UIを用意しています。通常の公開には、CSS・JavaScript・公式データを1ファイルに埋め込んだ `docs/index.html` を使います。

```bash
npm install
npm run dev
```

静的HTMLを生成する場合:

```bash
npm run build
```

生成物は `docs/index.html` に出力されます。このHTMLは `file://` で直接開いてもCSSと一覧画面が表示されます。GitHub Pages へは `.github/workflows/deploy-pages.yml` で `docs/` を自動デプロイします。

Next.js の静的エクスポートを確認したい場合だけ、次を使います。

```bash
npm run build:next
```
