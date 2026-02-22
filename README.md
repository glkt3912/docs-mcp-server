# docs-mcp-server

GitHub リポジトリまたはローカルの `docs/` 配下にある Markdown ドキュメントを Claude から参照できるようにする MCP サーバーです。

## 機能

| ツール | 説明 |
|--------|------|
| `list_documents` | ドキュメント一覧をメタデータとともに返す |
| `get_document_content` | 指定パスの Markdown 本文を取得する |
| `search_metadata` | キーワードによる重み付きスコアリング検索 |

## 必要条件

- Node.js 18.0.0 以上
- npm

## セットアップ

```bash
# 1. 依存関係インストール
npm install

# 2. ビルド
npm run build

# 3. 環境変数を設定（後述の環境変数一覧を参照）
export GITHUB_OWNER=your-org
export GITHUB_REPO=your-repo
```

## 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `LOCAL_MODE` | `true` でローカル `docs/` を参照 | `false` |
| `GITHUB_TOKEN` | GitHub PAT（Private リポジトリ用） | — |
| `GITHUB_OWNER` | リポジトリオーナー名 | — |
| `GITHUB_REPO` | リポジトリ名 | — |
| `GITHUB_BRANCH` | 参照ブランチ | `main` |
| `DOCS_BASE_PATH` | ローカル docs ディレクトリのパス | `./docs` |
| `FALLBACK_TO_LOCAL` | GitHub 失敗時にローカルへフォールバック | `false` |

## 起動

```bash
# ローカルモード
npm run start:local

# GitHub モード（環境変数設定済みの場合）
npm start
```

## Claude Code への登録

プロジェクトスコープで登録することで、このディレクトリで Claude Code を起動したときのみ自動接続されます。

1. テンプレートをコピーしてパスを書き換える：

```bash
cp .mcp.json.example .mcp.json
```

2. `.mcp.json` の `args` を自分の環境の絶対パスに変更する：

```json
{
  "mcpServers": {
    "docs": {
      "type": "stdio",
      "command": "node",
      "args": ["/your/path/to/docs-mcp-server/build/index.js"],
      "env": {
        "LOCAL_MODE": "true",
        "DOCS_BASE_PATH": "./docs"
      }
    }
  }
}
```

3. このディレクトリで Claude Code を起動すると自動で接続される：

```bash
claude
# 起動後 /mcp で接続状態を確認
```

> `.mcp.json` はマシン固有の絶対パスを含むため `.gitignore` で管理対象外にしています。チームで共有する場合は各自が `.mcp.json.example` からコピーして作成してください。

## ドキュメントの追加方法

1. `docs/` に Markdown ファイルを追加する
2. `docs/metadata.json` の `documents` 配列にエントリを追加する

```json
{
  "id": "new-doc",
  "path": "docs/new-doc.md",
  "title": "新しいドキュメント",
  "description": "説明文",
  "tags": ["タグ1", "タグ2"],
  "industry": ["IT"],
  "topics": ["トピック1"],
  "updatedAt": "2026-02-22"
}
```

### スコアリングと検索精度について

`search_metadata` はキーワードと各フィールドを照合し、以下の重みでスコアを算出します。

| フィールド | 一致の種類 | スコア |
|-----------|-----------|--------|
| `title` | 完全一致 | +10点 |
| `title` | 部分一致 | +5点 |
| `tags` | 部分一致（件数分） | +5点/件 |
| `industry` | 部分一致（件数分） | +4点/件 |
| `topics` | 部分一致（件数分） | +3点/件 |
| `description` | 部分一致 | +1点 |

**`tags` と `topics` を丁寧に設計するほど検索精度が上がります。** たとえば「認証」「JWT」「OAuth」のように同義語・関連語を複数列挙しておくと、さまざまなクエリでヒットしやすくなります。

## プロジェクト構成

```
docs-mcp-server/
├── src/
│   ├── index.ts              # エントリポイント（設定読み込み・起動）
│   ├── service.ts            # DocsService クラス・scoreDocument 関数
│   ├── server.ts             # MCP ツール登録
│   ├── types.ts              # Zod スキーマ・型定義
│   └── __tests__/
│       ├── scoreDocument.test.ts
│       └── service.test.ts
├── docs/
│   ├── metadata.json         # ドキュメント索引
│   ├── getting-started.md    # サンプルドキュメント
│   └── dependencies.md       # 依存パッケージ説明
├── build/                    # コンパイル成果物（git管理外）
├── claude_code_config.json   # Claude設定サンプル
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## 参考ドキュメント

- [依存パッケージ説明](./docs/dependencies.md)
- [はじめに（サンプル）](./docs/getting-started.md)
- [Model Context Protocol](https://modelcontextprotocol.io/)
