import { describe, it, expect } from "vitest";
import { scoreDocument } from "../service.js";
import { DocumentMetadata } from "../types.js";

const baseDoc: DocumentMetadata = {
  id: "test-doc",
  path: "docs/test.md",
  title: "テストドキュメント",
  description: "これはテスト用のドキュメントです",
  tags: ["テスト", "サンプル"],
  industry: ["製造業", "IT"],
  topics: ["品質管理", "自動化"],
  updatedAt: "2024-01-01",
};

describe("scoreDocument", () => {
  it("タイトル完全一致: +10点", () => {
    const score = scoreDocument(baseDoc, ["テストドキュメント"]);
    expect(score).toBe(10);
  });

  it("タイトル部分一致: +5点", () => {
    const score = scoreDocument(baseDoc, ["テスト"]);
    // タイトル部分一致(+5) + タグ「テスト」一致(+5) + description「テスト」一致(+1)
    expect(score).toBe(11);
  });

  it("タグ一致: +5点/件", () => {
    const doc: DocumentMetadata = { ...baseDoc, title: "別のタイトル", description: "別の説明" };
    const score = scoreDocument(doc, ["サンプル"]);
    expect(score).toBe(5);
  });

  it("industry 一致: +4点/件", () => {
    const doc: DocumentMetadata = {
      ...baseDoc,
      title: "別のタイトル",
      description: "別の説明",
      tags: [],
    };
    const score = scoreDocument(doc, ["製造業"]);
    expect(score).toBe(4);
  });

  it("topics 一致: +3点/件", () => {
    const doc: DocumentMetadata = {
      ...baseDoc,
      title: "別のタイトル",
      description: "別の説明",
      tags: [],
      industry: [],
    };
    const score = scoreDocument(doc, ["品質管理"]);
    expect(score).toBe(3);
  });

  it("description 部分一致: +1点", () => {
    const doc: DocumentMetadata = {
      ...baseDoc,
      title: "別のタイトル",
      tags: [],
      industry: [],
      topics: [],
    };
    const score = scoreDocument(doc, ["テスト用"]);
    expect(score).toBe(1);
  });

  it("複数キーワード: 累積スコア", () => {
    const doc: DocumentMetadata = {
      ...baseDoc,
      title: "製造業ドキュメント",
      description: "製造業向けの説明",
      tags: ["製造"],
      industry: ["製造業"],
      topics: [],
    };
    // "製造業": タイトル部分一致(+5) + タグ「製造」は「製造業」を含まないため0 + industry(+4) + description(+1) = 10
    // "製造": タイトル部分一致(+5) + タグ「製造」(+5) + industry「製造業」(+4) + description(+1) = 15
    const score = scoreDocument(doc, ["製造業", "製造"]);
    expect(score).toBeGreaterThan(10);
  });

  it("一致なし: 0点を返す", () => {
    const score = scoreDocument(baseDoc, ["存在しないキーワード"]);
    expect(score).toBe(0);
  });

  it("タイトル完全一致は部分一致よりも高スコア", () => {
    const exactMatch = scoreDocument(baseDoc, ["テストドキュメント"]);
    const partialMatch = scoreDocument(
      { ...baseDoc, title: "長いテストドキュメントタイトル" },
      ["テストドキュメント"]
    );
    expect(exactMatch).toBeGreaterThan(partialMatch);
  });
});
