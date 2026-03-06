import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DocsService, scoreDocument } from "./service.js";
import { OssService } from "./oss-service.js";
import { ScoredDocument } from "./types.js";

export function createServer(service: DocsService, ossService?: OssService): McpServer {
  const server = new McpServer({
    name: "docs-mcp-server",
    version: "1.0.0",
  });

  /**
   * ツール1: list_documents
   */
  server.registerTool(
    "list_documents",
    {
      title: "ドキュメント一覧取得",
      description:
        "利用可能なドキュメントの一覧をメタデータ（ID・タイトル・説明・タグ・業種）とともに返します。",
      inputSchema: {},
    },
    async () => {
      try {
        const metadata = await service.loadMetadata();
        const documents = metadata.documents.map((doc) => ({
          id: doc.id,
          title: doc.title,
          description: doc.description,
          tags: doc.tags,
          industry: doc.industry,
          path: doc.path,
          updatedAt: doc.updatedAt,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  version: metadata.version,
                  lastUpdated: metadata.lastUpdated,
                  count: documents.length,
                  documents,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[list_documents] エラー: ${message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `ドキュメント一覧の取得に失敗しました: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * ツール2: get_document_content
   */
  server.registerTool(
    "get_document_content",
    {
      title: "ドキュメント内容取得",
      description:
        "指定されたパスの Markdown ドキュメントの内容を取得します。LOCAL_MODE が有効な場合はローカルファイルを、無効な場合は GitHub から取得します。",
      inputSchema: {
        path: z
          .string()
          .describe(
            'ドキュメントのパス（例: "docs/getting-started.md"）。list_documents で取得した path フィールドを使用してください。'
          ),
      },
    },
    async ({ path: filePath }) => {
      try {
        const content = await service.fetchFile(filePath);
        const mode = service.config.localMode ? "ローカル" : "GitHub";
        console.error(`[get_document_content] 取得成功 (${mode}): ${filePath}`);

        return {
          content: [
            {
              type: "text" as const,
              text: content,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[get_document_content] エラー (${filePath}): ${message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `ドキュメントの取得に失敗しました (${filePath}): ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * ツール3: search_metadata
   */
  server.registerTool(
    "search_metadata",
    {
      title: "メタデータ検索",
      description:
        "キーワードでドキュメントメタデータを検索し、関連度スコア順に結果を返します。スペース区切りで複数キーワードを指定できます。",
      inputSchema: {
        query: z
          .string()
          .describe(
            '検索クエリ（例: "製造業 在庫管理"）。スペース区切りで複数キーワードを指定可能。'
          ),
      },
    },
    async ({ query }) => {
      try {
        const metadata = await service.loadMetadata();
        const keywords = query
          .trim()
          .split(/\s+/)
          .filter((k) => k.length > 0);

        if (keywords.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "検索クエリが空です。キーワードを入力してください。",
              },
            ],
            isError: true,
          };
        }

        const scored: ScoredDocument[] = metadata.documents
          .map((doc) => ({
            ...doc,
            score: scoreDocument(doc, keywords),
          }))
          .filter((doc) => doc.score > 0)
          .sort((a, b) => b.score - a.score);

        const result = {
          query,
          keywords,
          count: scored.length,
          results: scored.map(({ score, ...doc }) => ({
            score,
            id: doc.id,
            title: doc.title,
            description: doc.description,
            tags: doc.tags,
            industry: doc.industry,
            topics: doc.topics,
            path: doc.path,
          })),
        };

        console.error(
          `[search_metadata] クエリ: "${query}" → ${scored.length} 件ヒット`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[search_metadata] エラー: ${message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `メタデータ検索に失敗しました: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // OSS Analysis tools (available when ossService is provided)
  if (ossService) {
    /**
     * ツール4: register_oss
     */
    server.registerTool(
      "register_oss",
      {
        title: "OSSソース登録",
        description:
          "GitHub URL またはローカルパスに短いエイリアスを登録します。登録後は他の OSS ツールの source にエイリアスを使用できます。",
        inputSchema: {
          source: z
            .string()
            .describe('登録する GitHub URL またはローカル絶対パス'),
          alias: z
            .string()
            .describe('短い識別名（例: "nest", "mybff"）'),
        },
      },
      async ({ source, alias }) => {
        ossService.registerAlias(alias, source);
        console.error(`[register_oss] "${alias}" -> "${source}"`);
        return {
          content: [
            {
              type: "text" as const,
              text: `登録完了: "${alias}" -> "${source}"\n\n以降の OSS ツールで source="${alias}" と指定できます。`,
            },
          ],
        };
      }
    );

    /**
     * ツール5: list_oss_sources
     */
    server.registerTool(
      "list_oss_sources",
      {
        title: "登録済みOSSソース一覧",
        description: "register_oss で登録したエイリアスと対応ソースの一覧を返します。",
        inputSchema: {},
      },
      async () => {
        const entries = ossService.listAliases();
        if (entries.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "登録済みのエイリアスはありません。register_oss で登録してください。",
              },
            ],
          };
        }
        const text = entries
          .map((e) => `- "${e.alias}" -> ${e.source}`)
          .join("\n");
        return {
          content: [{ type: "text" as const, text: `登録済みソース:\n${text}` }],
        };
      }
    );

    /**
     * ツール6: analyze_oss
     */
    server.registerTool(
      "analyze_oss",
      {
        title: "OSSリポジトリ分析",
        description:
          "GitHub URL またはローカルパスを指定して、リポジトリ構造・主要ファイル・言語を分析します。",
        inputSchema: {
          source: z
            .string()
            .describe(
              'GitHub URL（例: "https://github.com/nestjs/nest"）またはローカルパス（例: "/path/to/repo"）'
            ),
        },
      },
      async ({ source }) => {
        try {
          const parsed = ossService.parseSource(source);
          const analysis = await ossService.analyze(parsed);
          console.error(`[analyze_oss] 完了: ${analysis.name}`);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(analysis, null, 2) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[analyze_oss] エラー: ${message}`);
          return {
            content: [{ type: "text" as const, text: `analyze_oss 失敗: ${message}` }],
            isError: true,
          };
        }
      }
    );

    /**
     * ツール7: get_oss_file
     */
    server.registerTool(
      "get_oss_file",
      {
        title: "OSSファイル取得",
        description: "OSSリポジトリ内の指定ファイルの内容を取得します。",
        inputSchema: {
          source: z.string().describe("GitHub URL またはローカルパス"),
          file_path: z
            .string()
            .describe('リポジトリルートからの相対パス（例: "src/index.ts"）'),
        },
      },
      async ({ source, file_path }) => {
        try {
          const parsed = ossService.parseSource(source);
          const content = await ossService.getFileContent(parsed, file_path);
          const ext = file_path.split(".").pop() ?? "";
          const text = `\`\`\`${ext}\n${content}\n\`\`\``;
          console.error(`[get_oss_file] 取得完了: ${file_path}`);
          return { content: [{ type: "text" as const, text }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[get_oss_file] エラー (${file_path}): ${message}`);
          return {
            content: [{ type: "text" as const, text: `get_oss_file 失敗: ${message}` }],
            isError: true,
          };
        }
      }
    );

    /**
     * ツール8: search_oss_code
     */
    server.registerTool(
      "search_oss_code",
      {
        title: "OSSコード検索",
        description: "OSSリポジトリ内のコードをキーワードで検索します（上位20件）。",
        inputSchema: {
          source: z.string().describe("GitHub URL またはローカルパス"),
          query: z.string().describe("検索キーワード"),
          file_pattern: z
            .string()
            .optional()
            .describe('ファイルパターン（例: "**/*.ts"）。ローカルモードのみ有効。'),
        },
      },
      async ({ source, query, file_pattern }) => {
        try {
          const parsed = ossService.parseSource(source);
          const results = await ossService.searchCode(parsed, query, file_pattern);
          console.error(`[search_oss_code] "${query}" → ${results.length} 件`);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(results, null, 2) },
            ],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[search_oss_code] エラー: ${message}`);
          return {
            content: [{ type: "text" as const, text: `search_oss_code 失敗: ${message}` }],
            isError: true,
          };
        }
      }
    );

    /**
     * ツール9: generate_oss_doc
     */
    server.registerTool(
      "generate_oss_doc",
      {
        title: "OSS学習ドキュメント生成",
        description:
          "OSSリポジトリを分析し、構造・モジュール・設計パターン・学習ポイントをまとめた Markdown ドキュメントを生成します。",
        inputSchema: {
          source: z.string().describe("GitHub URL またはローカルパス"),
          focus: z
            .enum(["architecture", "modules", "patterns", "all"])
            .optional()
            .describe('フォーカス領域。デフォルト: "all"'),
        },
      },
      async ({ source, focus }) => {
        try {
          const parsed = ossService.parseSource(source);
          const doc = await ossService.generateDoc(parsed, focus ?? "all");
          console.error(`[generate_oss_doc] 生成完了: ${source}`);
          return { content: [{ type: "text" as const, text: doc }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[generate_oss_doc] エラー: ${message}`);
          return {
            content: [{ type: "text" as const, text: `generate_oss_doc 失敗: ${message}` }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}
