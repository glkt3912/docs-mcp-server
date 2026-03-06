import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join, relative, isAbsolute, extname } from "path";
import { OssSource, FileNode, SearchResult, OssAnalysis } from "./types.js";

export interface GitHubTreeClient {
  git: {
    getTree(p: {
      owner: string;
      repo: string;
      tree_sha: string;
      recursive: string;
    }): Promise<{
      data: {
        tree: Array<{ path?: string; type?: string }>;
        truncated: boolean;
      };
    }>;
  };
  repos: {
    getContent(p: {
      owner: string;
      repo: string;
      path: string;
      ref: string;
    }): Promise<{ data: unknown }>;
    get(p: {
      owner: string;
      repo: string;
    }): Promise<{ data: { default_branch: string; language: string | null } }>;
  };
  search: {
    code(p: { q: string; per_page: number }): Promise<{
      data: {
        items: Array<{ path: string; html_url: string }>;
      };
    }>;
  };
}

const KEY_FILE_PATTERNS = [
  /^readme(\.(md|txt|rst))?$/i,
  /^package\.json$/,
  /^tsconfig(\..*)?\.json$/,
  /^go\.mod$/,
  /^cargo\.toml$/i,
  /^pyproject\.toml$/,
  /^setup\.py$/,
  /^makefile$/i,
  /^dockerfile$/i,
  /^\.env\.example$/,
  /^(jest|vitest|webpack|vite|rollup|babel)\.config\.(js|ts|mjs|cjs)$/,
];

const LANGUAGE_EXT_MAP: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".go": "Go",
  ".py": "Python",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".rb": "Ruby",
  ".php": "PHP",
  ".cs": "C#",
  ".cpp": "C++",
  ".c": "C",
};

export class OssService {
  private treeCache = new Map<string, Promise<FileNode[]>>();
  private aliasRegistry = new Map<string, string>(); // alias -> source

  constructor(private octokit?: GitHubTreeClient) {}

  registerAlias(alias: string, source: string): void {
    this.aliasRegistry.set(alias, source);
  }

  resolveAlias(source: string): string {
    return this.aliasRegistry.get(source) ?? source;
  }

  listAliases(): Array<{ alias: string; source: string }> {
    return Array.from(this.aliasRegistry.entries()).map(([alias, source]) => ({
      alias,
      source,
    }));
  }

  parseSource(rawSource: string): OssSource {
    const source = this.resolveAlias(rawSource);
    // GitHub URL パターン
    const githubMatch = source.match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/tree\/([^/]+))?(?:\/.*)?$/
    );
    if (githubMatch) {
      return {
        type: "github",
        owner: githubMatch[1],
        repo: githubMatch[2],
        branch: githubMatch[3] ?? "HEAD",
      };
    }

    // ローカルパス
    const rootPath = isAbsolute(source) ? source : resolve(process.cwd(), source);
    return { type: "local", rootPath };
  }

  private cacheKey(source: OssSource): string {
    if (source.type === "github") {
      return `github:${source.owner}/${source.repo}@${source.branch}`;
    }
    return `local:${source.rootPath}`;
  }

  async getFileTree(source: OssSource): Promise<FileNode[]> {
    const key = this.cacheKey(source);
    if (this.treeCache.has(key)) {
      return this.treeCache.get(key)!;
    }
    const promise =
      source.type === "github"
        ? this._getGitHubTree(source)
        : Promise.resolve(this._getLocalTree(source.rootPath, source.rootPath));
    this.treeCache.set(key, promise);
    return promise;
  }

  private async _getGitHubTree(source: Extract<OssSource, { type: "github" }>): Promise<FileNode[]> {
    if (!this.octokit) throw new Error("GitHub クライアントが設定されていません");

    const { data } = await this.octokit.git.getTree({
      owner: source.owner,
      repo: source.repo,
      tree_sha: source.branch,
      recursive: "1",
    });

    return data.tree
      .filter((item) => item.path && item.type)
      .map((item) => ({
        path: item.path!,
        type: item.type === "tree" ? "dir" : "file",
      }));
  }

  private _getLocalTree(rootPath: string, currentPath: string): FileNode[] {
    const nodes: FileNode[] = [];
    let entries: string[];
    try {
      entries = readdirSync(currentPath, { withFileTypes: false }) as string[];
    } catch {
      return nodes;
    }

    for (const entry of entries) {
      if (entry === ".git" || entry === "node_modules") continue;
      const fullPath = join(currentPath, entry);
      const relPath = relative(rootPath, fullPath);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        nodes.push({ path: relPath, type: "dir" });
        nodes.push(...this._getLocalTree(rootPath, fullPath));
      } else {
        nodes.push({ path: relPath, type: "file" });
      }
    }
    return nodes;
  }

  async getFileContent(source: OssSource, filePath: string): Promise<string> {
    if (source.type === "local") {
      const safePath = this._safeLocalPath(source.rootPath, filePath);
      return readFileSync(safePath, "utf-8");
    }

    if (!this.octokit) throw new Error("GitHub クライアントが設定されていません");

    const { data } = await this.octokit.repos.getContent({
      owner: source.owner,
      repo: source.repo,
      path: filePath,
      ref: source.branch,
    });

    if (Array.isArray(data)) {
      throw new Error(`指定パスはディレクトリです: ${filePath}`);
    }
    const fileData = data as { type?: string; content?: string };
    if (fileData.type !== "file" || !fileData.content) {
      throw new Error(`ファイルコンテンツを取得できません: ${filePath}`);
    }
    return Buffer.from(fileData.content, "base64").toString("utf-8");
  }

  private _safeLocalPath(rootPath: string, filePath: string): string {
    const abs = isAbsolute(filePath) ? filePath : resolve(rootPath, filePath);
    const rel = relative(rootPath, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`アクセス拒否: リポジトリルート外のパスです: ${filePath}`);
    }
    return abs;
  }

  async searchCode(source: OssSource, query: string, pattern?: string): Promise<SearchResult[]> {
    if (source.type === "github") {
      return this._searchGitHub(source, query);
    }
    return this._searchLocal(source.rootPath, query, pattern);
  }

  private async _searchGitHub(
    source: Extract<OssSource, { type: "github" }>,
    query: string
  ): Promise<SearchResult[]> {
    if (!this.octokit) throw new Error("GitHub クライアントが設定されていません");

    const q = `${query} repo:${source.owner}/${source.repo}`;
    const { data } = await this.octokit.search.code({ q, per_page: 20 });

    return data.items.map((item) => ({
      file: item.path,
      line: 0,
      content: `(GitHub Search) ${item.path}`,
      context: [item.html_url],
    }));
  }

  private _searchLocal(rootPath: string, query: string, pattern?: string): SearchResult[] {
    const tree = this._getLocalTree(rootPath, rootPath);
    const files = tree.filter((n) => n.type === "file");

    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();

    for (const node of files) {
      if (pattern && !this._matchGlob(node.path, pattern)) continue;

      let content: string;
      try {
        content = readFileSync(join(rootPath, node.path), "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(queryLower)) {
          results.push({
            file: node.path,
            line: i + 1,
            content: lines[i].trim(),
            context: lines.slice(Math.max(0, i - 1), i + 2).map((l) => l.trim()),
          });
          if (results.length >= 20) return results;
        }
      }
    }
    return results;
  }

  private _matchGlob(filePath: string, pattern: string): boolean {
    // 簡易 glob: **/*.ext 形式のみ対応
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*");
    return new RegExp(`^${escaped}$`).test(filePath);
  }

  async analyze(source: OssSource): Promise<OssAnalysis> {
    const tree = await this.getFileTree(source);
    const files = tree.filter((n) => n.type === "file");

    const keyFiles = files
      .filter((n) => {
        const basename = n.path.split("/").pop() ?? "";
        return KEY_FILE_PATTERNS.some((re) => re.test(basename));
      })
      .map((n) => n.path);

    const primaryLanguage = this._detectLanguage(files);

    let name: string;
    if (source.type === "github") {
      name = `${source.owner}/${source.repo}`;
    } else {
      name = source.rootPath.split("/").pop() ?? source.rootPath;
    }

    const topTree = tree.slice(0, 200);

    const dirCount = tree.filter((n) => n.type === "dir").length;
    const summary =
      `${name}: ${files.length} files, ${dirCount} directories. ` +
      `Primary language: ${primaryLanguage}. ` +
      `Key files: ${keyFiles.slice(0, 5).join(", ")}`;

    return {
      name,
      type: source.type,
      primaryLanguage,
      fileCount: files.length,
      tree: topTree,
      keyFiles,
      summary,
    };
  }

  private _detectLanguage(files: FileNode[]): string {
    const counts: Record<string, number> = {};
    for (const f of files) {
      const ext = extname(f.path);
      const lang = LANGUAGE_EXT_MAP[ext];
      if (lang) counts[lang] = (counts[lang] ?? 0) + 1;
    }
    if (Object.keys(counts).length === 0) return "Unknown";
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  async generateDoc(source: OssSource, focus: string = "all"): Promise<string> {
    const analysis = await this.analyze(source);

    // キーファイルの内容を取得（最大5件、最大5KB/件）
    const fileContents: Array<{ path: string; content: string }> = [];
    for (const keyFile of analysis.keyFiles.slice(0, 5)) {
      try {
        const raw = await this.getFileContent(source, keyFile);
        fileContents.push({ path: keyFile, content: raw.slice(0, 5000) });
      } catch {
        // 取得できないファイルはスキップ
      }
    }

    const sections: string[] = [];

    sections.push(`# ${analysis.name} 学習ドキュメント\n`);
    sections.push(`> 自動生成: focus="${focus}"\n`);

    if (focus === "all" || focus === "architecture") {
      sections.push(`## プロジェクト概要\n`);
      sections.push(analysis.summary + "\n");

      const readmeFile = fileContents.find((f) => /readme/i.test(f.path));
      if (readmeFile) {
        sections.push(`### README\n\`\`\`\n${readmeFile.content}\n\`\`\`\n`);
      }
    }

    if (focus === "all" || focus === "architecture") {
      sections.push(`## ディレクトリ構造\n`);
      const dirs = analysis.tree
        .filter((n) => n.type === "dir")
        .slice(0, 30)
        .map((n) => `- 📁 ${n.path}`)
        .join("\n");
      sections.push(dirs + "\n");
    }

    if (focus === "all" || focus === "modules") {
      sections.push(`## 主要ファイル一覧\n`);
      sections.push(analysis.keyFiles.map((f) => `- \`${f}\``).join("\n") + "\n");

      for (const { path, content } of fileContents) {
        if (/package\.json|go\.mod|cargo\.toml|pyproject/i.test(path)) {
          sections.push(`### ${path}\n\`\`\`json\n${content}\n\`\`\`\n`);
        }
      }
    }

    if (focus === "all" || focus === "patterns") {
      sections.push(`## 設計パターン・構成\n`);
      sections.push(
        `- 主要言語: **${analysis.primaryLanguage}**\n` +
          `- ファイル数: ${analysis.fileCount}\n`
      );

      const srcDirs = analysis.tree
        .filter((n) => n.type === "dir" && /^(src|lib|pkg|app|cmd|internal)/.test(n.path))
        .slice(0, 10)
        .map((n) => `- \`${n.path}\``)
        .join("\n");
      if (srcDirs) {
        sections.push(`\n主要ソースディレクトリ:\n${srcDirs}\n`);
      }
    }

    if (focus === "all") {
      sections.push(`## 学習ポイント\n`);
      sections.push(`### 推奨の読む順序\n`);
      const readOrder = [
        ...analysis.keyFiles.filter((f) => /readme/i.test(f)),
        ...analysis.keyFiles.filter((f) => /package\.json|go\.mod|cargo\.toml/.test(f)),
        ...analysis.keyFiles.filter((f) => /tsconfig|makefile/i.test(f)),
        ...analysis.tree
          .filter((n) => n.type === "file" && /\.(ts|go|py|rs|js)$/.test(n.path))
          .slice(0, 5)
          .map((n) => n.path),
      ];
      sections.push(readOrder.map((f, i) => `${i + 1}. \`${f}\``).join("\n") + "\n");
    }

    return sections.join("\n");
  }

  clearCache(): void {
    this.treeCache.clear();
  }
}
