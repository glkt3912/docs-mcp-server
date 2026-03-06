import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "@octokit/rest";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { DocsService, DocsConfig } from "./service.js";
import { OssService } from "./oss-service.js";
import { createServer } from "./server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.PROJECT_ROOT ?? resolve(__dirname, "..");

function buildConfig(): DocsConfig & { githubToken: string | undefined } {
  return {
    localMode: process.env.LOCAL_MODE === "true",
    fallbackToLocal: process.env.FALLBACK_TO_LOCAL === "true",
    githubOwner: process.env.GITHUB_OWNER,
    githubRepo: process.env.GITHUB_REPO,
    githubBranch: process.env.GITHUB_BRANCH ?? "main",
    docsBasePath: process.env.DOCS_BASE_PATH ?? "./docs",
    projectRoot: PROJECT_ROOT,
    githubToken: process.env.GITHUB_TOKEN,
  };
}

const config = buildConfig();
const octokit = new Octokit({ auth: config.githubToken });
const service = new DocsService(config, octokit);
const ossService = new OssService(octokit);
const server = createServer(service, ossService);

async function main() {
  const mode = config.localMode ? "ローカル" : "GitHub";
  console.error(`[docs-mcp-server] 起動中... モード: ${mode}`);

  if (!config.localMode) {
    if (!config.githubToken) {
      console.error(
        "[docs-mcp-server] 警告: GITHUB_TOKEN が設定されていません。Public リポジトリのみアクセス可能です。"
      );
    }
    if (!config.githubOwner || !config.githubRepo) {
      console.error(
        "[docs-mcp-server] エラー: GitHub モードでは GITHUB_OWNER と GITHUB_REPO の設定が必須です。"
      );
      process.exit(1);
    }
    console.error(
      `[docs-mcp-server] GitHub: ${config.githubOwner}/${config.githubRepo}@${config.githubBranch}`
    );
  } else {
    const resolvedDocsPath = resolve(PROJECT_ROOT, config.docsBasePath);
    const rootSource = process.env.PROJECT_ROOT ? "env" : "default";
    console.error(
      `[docs-mcp-server] ローカルパス: ${resolvedDocsPath} (PROJECT_ROOT: ${rootSource})`
    );
  }

  if (config.fallbackToLocal) {
    console.error(
      "[docs-mcp-server] フォールバック: GitHub 失敗時にローカルにフォールバックします。"
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[docs-mcp-server] 起動完了。stdio で待機中...");
}

main().catch((error) => {
  console.error("[docs-mcp-server] 致命的なエラー:", error);
  process.exit(1);
});
