# 依存パッケージ説明

このドキュメントでは `package.json` に定義された各パッケージの役割・選定理由・主な使用箇所を説明します。

---

## dependencies（本番依存）

### `@modelcontextprotocol/sdk`

| 項目 | 内容 |
|------|------|
| バージョン | ^1.27.0 |
| 公式 | <https://github.com/modelcontextprotocol/typescript-sdk> |
| ライセンス | MIT |

**役割**

Anthropic が策定した [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) の TypeScript 公式 SDK。
Claude などの AI モデルと外部ツール・データソースを安全に接続するためのプロトコル実装が含まれています。

**本プロジェクトでの使用箇所**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
```

- `McpServer` — MCP サーバーのインスタンスを生成し、ツールを登録する高レベル API
- `StdioServerTransport` — Claude Desktop / Claude Code と標準入出力（stdio）で通信するトランスポート層
- `server.registerTool()` — 各ツール（`list_documents` 等）をサーバーに登録するメソッド

**なぜこのバージョン？**

v1.27.0 以降で `McpServer` + `registerTool()` という高レベル API が安定化されました。
それ以前の `Server` + `tool()` は旧 API であり、現在は非推奨です。

---

### `@octokit/rest`

| 項目 | 内容 |
|------|------|
| バージョン | ^21.0.2 |
| 公式 | <https://github.com/octokit/rest.js> |
| ライセンス | MIT |
| 提供元 | GitHub 公式 |

**役割**

GitHub REST API のクライアントライブラリ。Private リポジトリへの認証付きアクセスや、リポジトリ内ファイルの取得に使用します。

**本プロジェクトでの使用箇所**

```typescript
import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: GITHUB_TOKEN });

const response = await octokit.repos.getContent({
  owner: GITHUB_OWNER,
  repo: GITHUB_REPO,
  path: filePath,
  ref: GITHUB_BRANCH,
});
```

`repos.getContent()` で GitHub Contents API を呼び出し、Markdown ファイルを Base64 デコードして取得します。

**主な間接依存パッケージ**

| パッケージ | 役割 |
|---|---|
| `@octokit/auth-token` | Personal Access Token (PAT) 認証 |
| `@octokit/request` | HTTP リクエスト処理 |
| `@octokit/request-error` | API エラーの型付き例外 |
| `@octokit/plugin-paginate-rest` | ページネーション対応 |
| `@octokit/plugin-rest-endpoint-methods` | 型安全な REST エンドポイントメソッド群 |

---

### `zod`

| 項目 | 内容 |
|------|------|
| バージョン | ^3.24.1 |
| 公式 | <https://zod.dev> |
| ライセンス | MIT |

**役割**

TypeScript ファーストのスキーマ宣言・バリデーションライブラリ。
`@modelcontextprotocol/sdk` が内部で `zod` を前提としており、ツールの入力スキーマ定義に必須です。

**本プロジェクトでの使用箇所**

```typescript
import { z } from "zod";

server.registerTool("get_document_content", {
  inputSchema: {
    path: z.string().describe("ドキュメントのパス"),
  },
}, handler);
```

`z.string()` などで入力パラメータの型・バリデーション・説明文を一括定義します。
Claude はこのスキーマを参照してツールの呼び出し方を理解します。

---

## devDependencies（開発時依存）

### `typescript`

| 項目 | 内容 |
|------|------|
| バージョン | ^5.7.2 |
| 公式 | <https://www.typescriptlang.org> |
| ライセンス | Apache-2.0 |

**役割**

`src/index.ts` を `build/index.js` にトランスパイルするコンパイラ。
`npm run build` で実行され、成果物は `build/` ディレクトリに出力されます。

`tsconfig.json` の主要設定：

| オプション | 値 | 理由 |
|---|---|---|
| `module` | `Node16` | ESM (`"type": "module"`) + `.js` 拡張子の明示的インポートに対応 |
| `moduleResolution` | `Node16` | SDK の ESM パッケージ解決に対応 |
| `target` | `ES2022` | Node.js 18 以上で動作する最新構文を使用 |

---

### `@types/node`

| 項目 | 内容 |
|------|------|
| バージョン | ^22.10.5 |
| 公式 | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| ライセンス | MIT |

**役割**

Node.js 組み込みモジュール（`fs/promises`、`path`、`url`、`Buffer` など）の TypeScript 型定義。
これがないと `readFile`、`resolve`、`join`、`fileURLToPath` などの型が解決されません。

**本プロジェクトでの使用箇所**

```typescript
import { readFile } from "fs/promises";   // Node.js 組み込み
import { resolve, join } from "path";     // Node.js 組み込み
import { fileURLToPath } from "url";      // Node.js 組み込み
```

---

## パッケージ選定の全体方針

```
┌─────────────────────────────────────────────────┐
│  Claude Code / Claude Desktop                   │
│  （MCP クライアント）                             │
└──────────────┬──────────────────────────────────┘
               │ stdio (JSON-RPC)
               ▼
┌─────────────────────────────────────────────────┐
│  @modelcontextprotocol/sdk                      │
│  ├── McpServer（ツール登録・ルーティング）        │
│  └── StdioServerTransport（通信層）              │
└───────┬─────────────────┬───────────────────────┘
        │                 │
        ▼                 ▼
┌───────────────┐  ┌─────────────────────────────┐
│  zod          │  │  @octokit/rest              │
│  入力バリデ   │  │  GitHub Contents API 呼び出し│
└───────────────┘  └─────────────────────────────┘
```

- **最小限の依存**: 本番依存は 3 パッケージのみ。セキュリティ攻撃面を最小化しています。
- **公式ライブラリ優先**: MCP SDK（Anthropic）、Octokit（GitHub）いずれも公式提供のライブラリを採用。
- **`npm audit` 結果**: 現時点で既知の脆弱性 **0 件**。
