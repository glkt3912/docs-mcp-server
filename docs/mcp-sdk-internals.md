# MCP SDK 内部構造：McpServer と StdioServerTransport

このドキュメントでは `@modelcontextprotocol/sdk` の中核となる2つのクラス、
`McpServer` と `StdioServerTransport` の役割・仕組み・使い方を解説します。

---

## 全体像

```text
Claude Code（MCP クライアント）
        │
        │  JSON-RPC 2.0 メッセージ（stdin/stdout）
        │
        ▼
┌─────────────────────────────────────┐
│  StdioServerTransport               │  ← 通信層：バイト列 ↔ JSON-RPC
│  ↕                                  │
│  McpServer                          │  ← ルーティング層：メソッド → ハンドラ
│  ├── registerTool("list_documents") │
│  ├── registerTool("get_document")   │
│  └── registerTool("search_metadata")│
└─────────────────────────────────────┘
```

---

## JSON-RPC とは

**JSON-RPC 2.0** は、JSON を使ってリモートプロシージャを呼び出すための軽量プロトコルです。
HTTP のような複雑な仕様を持たず、シンプルなメッセージ形式で関数呼び出しを表現します。

### リクエスト形式

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_metadata",
    "arguments": { "query": "認証" }
  }
}
```

| フィールド | 説明 |
| --------- | ---- |
| `jsonrpc` | バージョン識別子。常に `"2.0"` |
| `id` | リクエストとレスポンスを対応付けるID |
| `method` | 呼び出すメソッド名 |
| `params` | メソッドへの引数 |

### レスポンス形式

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "検索結果..." }]
  }
}
```

エラーの場合は `result` の代わりに `error` フィールドが入ります。

### MCP での使われ方

MCP は JSON-RPC 2.0 を **NDJSON（Newline-Delimited JSON）** 形式で使います。
1メッセージ = 1行（`\n` 区切り）で stdin/stdout に流れます。

```text
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n
{"jsonrpc":"2.0","id":1,"result":{"tools":[...]}}\n
```

`StdioServerTransport` がこの変換（バイト列 ↔ JSON-RPC オブジェクト）を担います。

---

## McpServer

### 役割

MCP プロトコルのサーバー側実装。ツール・リソース・プロンプトを登録し、
クライアントからのリクエストを対応するハンドラに振り分けます。

### 初期化

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer({
  name: "docs-mcp-server",   // クライアントに表示されるサーバー名
  version: "1.0.0",
});
```

### ツール登録：registerTool()

```typescript
server.registerTool(
  "tool_name",          // ツール識別子（クライアントが呼び出す名前）
  {
    title: "表示名",
    description: "ツールの説明（Claude がツール選択の判断に使う）",
    inputSchema: {
      param: z.string().describe("パラメータの説明"),
    },
  },
  async ({ param }) => {  // ハンドラ関数
    return {
      content: [{ type: "text", text: "結果" }],
    };
  }
);
```

**`description` はツール選択精度に直結します。** Claude はこの文字列を読んで
「どのツールを呼ぶべきか」を判断するため、具体的に書くほど精度が上がります。

### ハンドラの戻り値

```typescript
// 正常レスポンス
return {
  content: [{ type: "text", text: "..." }],
};

// エラーレスポンス
return {
  content: [{ type: "text", text: "エラーメッセージ" }],
  isError: true,
};
```

`isError: true` を返すと Claude 側でエラーとして扱われます。
例外を throw した場合も SDK が自動でエラーレスポンスに変換します。

### 内部で処理されるメソッド

`McpServer` は以下の JSON-RPC メソッドを自動で処理します。

| メソッド | 内容 |
| -------- | ---- |
| `initialize` | クライアントとのハンドシェイク・プロトコルバージョン交渉 |
| `tools/list` | 登録済みツール一覧を返す |
| `tools/call` | 指定ツールのハンドラを実行して結果を返す |
| `ping` | 死活確認 |

---

## StdioServerTransport

### 通信層の役割

`process.stdin` / `process.stdout` を使って Claude Code と通信する層。
バイト列の読み書きと JSON-RPC メッセージへのシリアライズ・デシリアライズを担います。

### 仕組み

```text
stdin  →  行単位で読み込み  →  JSON.parse  →  McpServer へ渡す
stdout ←  JSON.stringify   ←  McpServer から受け取り
```

MCP は **JSON-RPC 2.0** over **NDJSON** を使っており、
1メッセージ = 1行（`\n` 区切り）です。

### 使い方

```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const transport = new StdioServerTransport();
await server.connect(transport);
// この時点から stdin のリッスンが始まる
```

`server.connect(transport)` を呼ぶまでクライアントからのメッセージは処理されません。

### stderr へのログ出力

`stdout` はプロトコルメッセージ専用のため、**デバッグログは必ず `stderr` に出力します。**

```typescript
// ✅ 正しい
console.error("[debug] 処理開始");

// ❌ プロトコルを破壊する
console.log("[debug] 処理開始");
```

---

## server.connect() が行うこと

```typescript
await server.connect(transport);
```

1. `transport` に `McpServer` のメッセージハンドラを登録
2. `stdin` のリッスン開始
3. `initialize` リクエストを待機
4. Claude Code とのハンドシェイク完了後、ツール呼び出しを受け付ける

`connect()` は非同期ですが、完了後もプロセスは終了しません。
`stdin` がクローズされるまでイベントループが維持されます。

---

## この実装での使われ方

```typescript
// src/index.ts
const service = new DocsService(config, octokit);
const server = createServer(service);   // src/server.ts でツール登録

const transport = new StdioServerTransport();
await server.connect(transport);        // stdio 通信開始
```

`createServer()` でツールを登録した `McpServer` インスタンスを作り、
`StdioServerTransport` に繋ぐことで Claude Code からの呼び出しを受け付けます。
