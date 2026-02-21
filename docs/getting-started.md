# はじめに

このドキュメントでは、プロジェクトの概要と基本的なセットアップ手順を説明します。

## 概要

本プロジェクトは、GitHub リポジトリの `docs/` 配下にある Markdown ドキュメントを Claude から参照できるようにする MCP サーバーです。

### 主な機能

- **ドキュメント一覧取得**: `list_documents` ツールで利用可能なドキュメント一覧を取得
- **ドキュメント内容取得**: `get_document_content` ツールで特定のドキュメントの内容を取得
- **メタデータ検索**: `search_metadata` ツールでキーワードによる関連ドキュメント検索

## 必要条件

- Node.js 18.0.0 以上
- npm または yarn
- GitHub Personal Access Token（Private リポジトリを参照する場合）

## インストール手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/your-org/docs-mcp-server.git
cd docs-mcp-server
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. ビルド

```bash
npm run build
```

### 4. 環境変数の設定

`.env` ファイルを作成するか、環境変数を直接設定します。

**ローカルモードの場合:**

```bash
export LOCAL_MODE=true
export DOCS_BASE_PATH=./docs
```

**GitHub モードの場合:**

```bash
export LOCAL_MODE=false
export GITHUB_TOKEN=ghp_your_token_here
export GITHUB_OWNER=your-org
export GITHUB_REPO=your-repo
export GITHUB_BRANCH=main
```

## 起動方法

### ローカルモード

```bash
npm run start:local
# または
LOCAL_MODE=true node build/index.js
```

### GitHub モード

```bash
node build/index.js
```

## Claude Code への登録

`~/.claude/settings.json` の `mcpServers` セクションに以下を追加します。

```json
{
  "mcpServers": {
    "docs-mcp": {
      "command": "node",
      "args": ["/path/to/docs-mcp-server/build/index.js"],
      "env": {
        "LOCAL_MODE": "false",
        "GITHUB_TOKEN": "ghp_your_token_here",
        "GITHUB_OWNER": "your-org",
        "GITHUB_REPO": "your-repo",
        "GITHUB_BRANCH": "main"
      }
    }
  }
}
```

Claude Code を再起動すると、MCP ツールが利用可能になります。

## トラブルシューティング

### よくある問題

**Q: `GITHUB_TOKEN` が必要ですか？**

A: Private リポジトリを参照する場合は必要です。Public リポジトリのみであれば不要ですが、API レート制限を回避するために設定を推奨します。

**Q: ローカルモードで動作確認したい場合は？**

A: `LOCAL_MODE=true` を設定し、`DOCS_BASE_PATH` にドキュメントフォルダのパスを指定してください。

**Q: GitHub API のレート制限に引っかかった場合は？**

A: `FALLBACK_TO_LOCAL=true` を設定すると、API 失敗時にローカルの `docs/` フォルダにフォールバックします。
