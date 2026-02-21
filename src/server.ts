import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DocsService, scoreDocument } from "./service.js";
import { ScoredDocument } from "./types.js";

export function createServer(service: DocsService): McpServer {
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

  return server;
}
