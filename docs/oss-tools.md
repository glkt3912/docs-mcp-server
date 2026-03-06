# OSS分析・学習ツール

GitHub URL またはローカルパスを指定するだけで、任意の OSS リポジトリを Claude と一緒に読み解くための MCP ツール群です。

## ツール一覧

### `register_oss`

GitHub URL またはローカルパスに短いエイリアスを登録します。登録後は他の OSS ツールの `source` にエイリアスを使用できます。

**入力**

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `source` | string | GitHub URL またはローカル絶対パス |
| `alias` | string | 短い識別名（例: `"nest"`, `"mybff"`） |

**使用例**

```
register_oss: source="https://github.com/nestjs/nest", alias="nest"
register_oss: source="/Volumes/Dev-SSD/dev/nestjs-bff", alias="mybff"
```

---

### `list_oss_sources`

`register_oss` で登録したエイリアスと対応ソースの一覧を返します。

**入力**: なし

**使用例**

```
list_oss_sources
```

---

### `analyze_oss`

リポジトリの全体像を把握します。

**入力**

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `source` | string | GitHub URL またはローカル絶対パス |

**出力 (JSON)**

```json
{
  "name": "nestjs/nest",
  "type": "github",
  "primaryLanguage": "TypeScript",
  "fileCount": 1024,
  "tree": [{ "path": "src/index.ts", "type": "file" }, ...],
  "keyFiles": ["README.md", "package.json", "tsconfig.json"],
  "summary": "nestjs/nest: 1024 files, 128 directories. Primary language: TypeScript."
}
```

**使用例**

```
analyze_oss: source="https://github.com/nestjs/nest"
analyze_oss: source="/Volumes/Dev-SSD/dev/nestjs-bff"
```

---

### `get_oss_file`

リポジトリ内の任意ファイルの内容を取得します。

**入力**

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `source` | string | GitHub URL またはローカル絶対パス |
| `file_path` | string | リポジトリルートからの相対パス |

**使用例**

```
get_oss_file: source="https://github.com/nestjs/nest", file_path="packages/core/injector/container.ts"
get_oss_file: source="/Volumes/Dev-SSD/dev/nestjs-bff", file_path="src/main.ts"
```

---

### `search_oss_code`

キーワードでコードを横断検索します（上位20件）。

**入力**

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `source` | string | GitHub URL またはローカル絶対パス |
| `query` | string | 検索キーワード |
| `file_pattern` | string（任意） | ファイルパターン（例: `**/*.ts`）。ローカルモードのみ有効。 |

**出力 (JSON)**

```json
[
  {
    "file": "src/core/injector.ts",
    "line": 42,
    "content": "  @Injectable()",
    "context": ["", "  @Injectable()", "  export class Injector {"]
  }
]
```

**GitHub モードの注意**

GitHub Search API を使用します。`GITHUB_TOKEN` 未設定時はレートリミット（10 req/min）が厳しいため、認証トークンの設定を推奨します。

**使用例**

```
search_oss_code: source="https://github.com/nestjs/nest", query="@Injectable"
search_oss_code: source="/Volumes/Dev-SSD/dev/nestjs-bff", query="AxiosExceptionFilter", file_pattern="**/*.ts"
```

---

### `generate_oss_doc`

リポジトリを分析して学習用 Markdown ドキュメントを自動生成します。

**入力**

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `source` | string | GitHub URL またはローカル絶対パス |
| `focus` | string（任意） | `architecture` / `modules` / `patterns` / `all`（デフォルト: `all`） |

**focus の意味**

| 値 | 生成されるセクション |
|----|---------------------|
| `architecture` | プロジェクト概要、README、ディレクトリ構造 |
| `modules` | 主要ファイル一覧、package.json 等の依存定義 |
| `patterns` | 主要言語・ファイル数・ソースディレクトリ構成 |
| `all` | 上記すべて + 推奨の読む順序 |

**使用例**

```
generate_oss_doc: source="https://github.com/nestjs/nest", focus="architecture"
generate_oss_doc: source="/Volumes/Dev-SSD/dev/nestjs-bff", focus="all"
```

---

## エイリアスを使った効率的なワークフロー

毎回フル URL / フルパスを入力する手間を省けます。

```text
# 1. 一度だけ登録
register_oss: source="https://github.com/nestjs/nest", alias="nest"
register_oss: source="/Volumes/Dev-SSD/dev/nestjs-bff", alias="mybff"

# 2. 以降はエイリアスで呼べる
analyze_oss:      source="nest"
get_oss_file:     source="mybff", file_path="src/main.ts"
search_oss_code:  source="nest", query="@Injectable"
generate_oss_doc: source="mybff", focus="architecture"

# 3. 一覧確認
list_oss_sources
```

エイリアスは MCP サーバーが起動している間有効です。再起動後も使いたい場合は `.mcp.json` の `OSS_ALIASES` 環境変数に定義してください。

```json
{
  "env": {
    "OSS_ALIASES": "mybff=/Volumes/Dev-SSD/dev/nestjs-bff,nest=https://github.com/nestjs/nest"
  }
}
```

---

## source の書き方

```text
# GitHub リポジトリ（デフォルトブランチ）
https://github.com/owner/repo

# GitHub リポジトリ（ブランチ指定）
https://github.com/owner/repo/tree/develop

# ローカルパス（絶対パス）
/Volumes/Dev-SSD/dev/my-project
```

## キャッシュ

`analyze_oss` / `search_oss_code` / `generate_oss_doc` は内部でファイルツリーをキャッシュします。同一 `source` への2回目以降のアクセスは高速です。MCP サーバーを再起動するとキャッシュはクリアされます。

## 既存ツールとのパフォーマンス分離

OSS ツールは `list_documents` / `get_document_content` / `search_metadata` と完全に独立しています。OSS ツールを使用しない限り、既存ドキュメント管理ツールのレイテンシ・API 消費に影響はありません。
