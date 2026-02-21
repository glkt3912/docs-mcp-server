import { readFile } from "fs/promises";
import { resolve, relative, isAbsolute } from "path";
import { DocumentMetadata, MetadataFile, MetadataFileSchema } from "./types.js";

// テスト時に mock しやすい最小限の型
export interface GitHubClient {
  repos: {
    getContent(p: {
      owner: string;
      repo: string;
      path: string;
      ref: string;
    }): Promise<{ data: unknown }>;
    getBranch(p: {
      owner: string;
      repo: string;
      branch: string;
    }): Promise<{ data: { commit: { sha: string } } }>;
  };
}

export interface DocsConfig {
  localMode: boolean;
  fallbackToLocal: boolean;
  githubOwner: string | undefined;
  githubRepo: string | undefined;
  githubBranch: string;
  docsBasePath: string;
  projectRoot: string;
}

type ReadFileFn = (path: string, encoding: "utf-8") => Promise<string>;

export class DocsService {
  private fetchPromiseCache = new Map<string, Promise<string>>();
  private lastKnownSha: string | null = null;

  constructor(
    readonly config: DocsConfig,
    private readonly github: GitHubClient,
    private readonly readFileFn: ReadFileFn = readFile,
  ) {}

  /**
   * ローカルの docs/ フォルダからファイルを読み込む
   * パストラバーサル対策: relative() で docsBasePath 外へのアクセスを拒否する
   */
  async readLocalFile(filePath: string): Promise<string> {
    const basePath = resolve(this.config.projectRoot, this.config.docsBasePath);
    const absolutePath = resolve(this.config.projectRoot, filePath);

    const rel = relative(basePath, absolutePath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`アクセス拒否: 許可されたディレクトリ外のパスです`);
    }

    return this.readFileFn(absolutePath, "utf-8");
  }

  /**
   * GitHub Contents API のブランチ情報を確認し、SHA が変わっていればキャッシュを無効化する
   */
  async checkAndInvalidateCache(): Promise<void> {
    if (!this.config.githubOwner || !this.config.githubRepo) return;

    try {
      const { data } = await this.github.repos.getBranch({
        owner: this.config.githubOwner,
        repo: this.config.githubRepo,
        branch: this.config.githubBranch,
      });
      const currentSha = data.commit.sha;
      if (this.lastKnownSha !== null && this.lastKnownSha !== currentSha) {
        this.fetchPromiseCache.clear();
        console.error(
          `[cache] SHA 変更検知 (${this.lastKnownSha.slice(0, 7)} → ${currentSha.slice(0, 7)}) → キャッシュクリア`
        );
      }
      this.lastKnownSha = currentSha;
    } catch (error) {
      console.error(`[cache] SHA 確認失敗（キャッシュを継続使用）:`, error);
    }
  }

  /**
   * GitHub Contents API からファイルを取得する（Promise キャッシュ付き）
   */
  async fetchGitHubFile(filePath: string): Promise<string> {
    if (!this.config.githubOwner || !this.config.githubRepo) {
      throw new Error(
        "GitHub モードでは GITHUB_OWNER と GITHUB_REPO の設定が必要です。"
      );
    }

    await this.checkAndInvalidateCache();

    const cacheKey = `${this.config.githubOwner}/${this.config.githubRepo}/${this.config.githubBranch}/${filePath}`;

    if (this.fetchPromiseCache.has(cacheKey)) {
      console.error(`[cache hit] ${cacheKey}`);
      return this.fetchPromiseCache.get(cacheKey)!;
    }

    const promise = this.github.repos
      .getContent({
        owner: this.config.githubOwner,
        repo: this.config.githubRepo,
        path: filePath,
        ref: this.config.githubBranch,
      })
      .then((response) => {
        const data = response.data;

        if (Array.isArray(data)) {
          throw new Error(
            `指定されたパスはファイルではなくディレクトリです: ${filePath}`
          );
        }

        const fileData = data as { type?: string; content?: string };
        if (fileData.type !== "file" || !("content" in fileData)) {
          throw new Error(`ファイルコンテンツを取得できません: ${filePath}`);
        }

        return Buffer.from(fileData.content!, "base64").toString("utf-8");
      })
      .catch((error) => {
        this.fetchPromiseCache.delete(cacheKey);
        throw error;
      });

    this.fetchPromiseCache.set(cacheKey, promise);
    return promise;
  }

  /**
   * ファイルを取得する（localMode に応じて切り替え）
   */
  async fetchFile(filePath: string): Promise<string> {
    if (this.config.localMode) {
      return this.readLocalFile(filePath);
    }

    try {
      return await this.fetchGitHubFile(filePath);
    } catch (error) {
      if (this.config.fallbackToLocal) {
        console.error(
          `[fallback] GitHub からの取得に失敗しました。ローカルにフォールバックします: ${filePath}`
        );
        console.error(error);
        return this.readLocalFile(filePath);
      }
      throw error;
    }
  }

  /**
   * metadata.json を読み込む
   */
  async loadMetadata(): Promise<MetadataFile> {
    const metadataPath = `${this.config.docsBasePath}/metadata.json`;
    const content = await this.fetchFile(metadataPath);
    return MetadataFileSchema.parse(JSON.parse(content));
  }

  clearCache(): void {
    this.fetchPromiseCache.clear();
    this.lastKnownSha = null;
  }
}

/**
 * クエリに対してドキュメントをスコアリングする
 */
export function scoreDocument(doc: DocumentMetadata, keywords: string[]): number {
  let score = 0;

  for (const keyword of keywords) {
    const kw = keyword.toLowerCase();

    // タイトル完全一致: +10点
    if (doc.title.toLowerCase() === kw) {
      score += 10;
    }
    // タイトル部分一致: +5点
    else if (doc.title.toLowerCase().includes(kw)) {
      score += 5;
    }

    // タグ一致: +5点/件
    for (const tag of doc.tags) {
      if (tag.toLowerCase().includes(kw)) {
        score += 5;
      }
    }

    // industry 一致: +4点/件
    for (const ind of doc.industry) {
      if (ind.toLowerCase().includes(kw)) {
        score += 4;
      }
    }

    // topics 一致: +3点/件
    for (const topic of doc.topics) {
      if (topic.toLowerCase().includes(kw)) {
        score += 3;
      }
    }

    // description 部分一致: +1点
    if (doc.description.toLowerCase().includes(kw)) {
      score += 1;
    }
  }

  return score;
}
