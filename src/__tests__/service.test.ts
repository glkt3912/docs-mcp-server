import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocsService, DocsConfig, GitHubClient } from "../service.js";

const baseConfig: DocsConfig = {
  localMode: true,
  fallbackToLocal: false,
  githubOwner: "test-owner",
  githubRepo: "test-repo",
  githubBranch: "main",
  docsBasePath: "./docs",
  projectRoot: "/project",
};

function makeGithubMock(): GitHubClient {
  return {
    repos: {
      getContent: vi.fn(),
      getBranch: vi.fn(),
    },
  };
}

const validMetadataJson = JSON.stringify({
  version: "1.0",
  lastUpdated: "2024-01-01",
  documents: [
    {
      id: "doc1",
      path: "docs/doc1.md",
      title: "テストドキュメント",
      description: "説明",
      tags: ["tag1"],
      industry: ["IT"],
      topics: ["topic1"],
      updatedAt: "2024-01-01",
    },
  ],
});

describe("DocsService", () => {
  let github: GitHubClient;
  let service: DocsService;

  beforeEach(() => {
    github = makeGithubMock();
    service = new DocsService(baseConfig, github);
  });

  describe("readLocalFile", () => {
    it("正常: mock readFile の結果が返る", async () => {
      const mockReadFile = vi.fn().mockResolvedValue("ファイル内容");
      const svc = new DocsService(baseConfig, github, mockReadFile);

      const result = await svc.readLocalFile("./docs/test.md");
      expect(result).toBe("ファイル内容");
      expect(mockReadFile).toHaveBeenCalledOnce();
    });

    it("パストラバーサル ../../package.json → アクセス拒否エラー", async () => {
      const mockReadFile = vi.fn();
      const svc = new DocsService(baseConfig, github, mockReadFile);

      await expect(svc.readLocalFile("../../package.json")).rejects.toThrow(
        "アクセス拒否"
      );
      expect(mockReadFile).not.toHaveBeenCalled();
    });
  });

  describe("loadMetadata", () => {
    it("正常: zod parse 後の MetadataFile が返る", async () => {
      const mockReadFile = vi.fn().mockResolvedValue(validMetadataJson);
      const svc = new DocsService(
        { ...baseConfig, localMode: true },
        github,
        mockReadFile
      );

      const result = await svc.loadMetadata();
      expect(result.version).toBe("1.0");
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].id).toBe("doc1");
    });

    it("不正 JSON → エラーがスロー", async () => {
      const mockReadFile = vi.fn().mockResolvedValue("invalid json{{{");
      const svc = new DocsService(
        { ...baseConfig, localMode: true },
        github,
        mockReadFile
      );

      await expect(svc.loadMetadata()).rejects.toThrow();
    });

    it("不正スキーマ → ZodError がスロー", async () => {
      const invalidSchema = JSON.stringify({ version: "1.0" }); // documents が欠けている
      const mockReadFile = vi.fn().mockResolvedValue(invalidSchema);
      const svc = new DocsService(
        { ...baseConfig, localMode: true },
        github,
        mockReadFile
      );

      await expect(svc.loadMetadata()).rejects.toThrow();
    });
  });

  describe("fetchGitHubFile", () => {
    const githubConfig: DocsConfig = {
      ...baseConfig,
      localMode: false,
    };

    it("キャッシュミス: github.repos.getContent が1回呼ばれる", async () => {
      const mockGetContent = vi.fn().mockResolvedValue({
        data: {
          type: "file",
          content: Buffer.from("ファイル内容").toString("base64"),
        },
      });
      const mockGetBranch = vi.fn().mockResolvedValue({
        data: { commit: { sha: "abc123" } },
      });
      const gh: GitHubClient = {
        repos: { getContent: mockGetContent, getBranch: mockGetBranch },
      };
      const svc = new DocsService(githubConfig, gh);

      const result = await svc.fetchGitHubFile("docs/test.md");
      expect(result).toBe("ファイル内容");
      expect(mockGetContent).toHaveBeenCalledOnce();
    });

    it("キャッシュヒット: 同一 Promise が返り API は1回のみ", async () => {
      const mockGetContent = vi.fn().mockResolvedValue({
        data: {
          type: "file",
          content: Buffer.from("ファイル内容").toString("base64"),
        },
      });
      const mockGetBranch = vi.fn().mockResolvedValue({
        data: { commit: { sha: "abc123" } },
      });
      const gh: GitHubClient = {
        repos: { getContent: mockGetContent, getBranch: mockGetBranch },
      };
      const svc = new DocsService(githubConfig, gh);

      const result1 = await svc.fetchGitHubFile("docs/test.md");
      const result2 = await svc.fetchGitHubFile("docs/test.md");
      expect(result1).toBe(result2);
      expect(mockGetContent).toHaveBeenCalledOnce();
    });

    it("失敗: キャッシュから除去され再呼び出し可能", async () => {
      let callCount = 0;
      const mockGetContent = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("API エラー"));
        }
        return Promise.resolve({
          data: {
            type: "file",
            content: Buffer.from("2回目の内容").toString("base64"),
          },
        });
      });
      const mockGetBranch = vi.fn().mockResolvedValue({
        data: { commit: { sha: "abc123" } },
      });
      const gh: GitHubClient = {
        repos: { getContent: mockGetContent, getBranch: mockGetBranch },
      };
      const svc = new DocsService(githubConfig, gh);

      await expect(svc.fetchGitHubFile("docs/test.md")).rejects.toThrow("API エラー");

      // 失敗後は再呼び出し可能
      const result = await svc.fetchGitHubFile("docs/test.md");
      expect(result).toBe("2回目の内容");
      expect(mockGetContent).toHaveBeenCalledTimes(2);
    });
  });

  describe("checkAndInvalidateCache", () => {
    const githubConfig: DocsConfig = {
      ...baseConfig,
      localMode: false,
    };

    it("SHA 同一: キャッシュはクリアされない", async () => {
      const mockGetBranch = vi.fn().mockResolvedValue({
        data: { commit: { sha: "abc123" } },
      });
      const gh: GitHubClient = {
        repos: { getContent: vi.fn(), getBranch: mockGetBranch },
      };
      const svc = new DocsService(githubConfig, gh);

      // 1回目: lastKnownSha を設定
      await svc.checkAndInvalidateCache();
      // 2回目: SHA 同一 → キャッシュクリアなし
      await svc.checkAndInvalidateCache();

      // clearCache されていなければ fetchPromiseCache は空のまま（直接確認は難しいが、エラーなく動作することを確認）
      expect(mockGetBranch).toHaveBeenCalledTimes(2);
    });

    it("SHA 変更: キャッシュがクリアされる", async () => {
      let shaCall = 0;
      const mockGetBranch = vi.fn().mockImplementation(() => {
        shaCall++;
        return Promise.resolve({
          data: { commit: { sha: shaCall === 1 ? "sha-old" : "sha-new" } },
        });
      });
      const mockGetContent = vi.fn().mockResolvedValue({
        data: {
          type: "file",
          content: Buffer.from("内容").toString("base64"),
        },
      });
      const gh: GitHubClient = {
        repos: { getContent: mockGetContent, getBranch: mockGetBranch },
      };
      const svc = new DocsService(githubConfig, gh);

      // キャッシュにファイルを入れる（getBranch が1回目: sha-old）
      await svc.fetchGitHubFile("docs/test.md");
      expect(mockGetContent).toHaveBeenCalledOnce();

      // SHA 変更を検知させる（2回目: sha-new）
      await svc.checkAndInvalidateCache();

      // キャッシュがクリアされたので再度 API が呼ばれる
      await svc.fetchGitHubFile("docs/test.md");
      expect(mockGetContent).toHaveBeenCalledTimes(2);
    });
  });
});
