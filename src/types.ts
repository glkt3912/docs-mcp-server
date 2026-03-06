import { z } from "zod";

export const DocumentMetadataSchema = z.object({
  id: z.string(),
  path: z.string(),
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  industry: z.array(z.string()),
  topics: z.array(z.string()),
  updatedAt: z.string(),
});

export const MetadataFileSchema = z.object({
  version: z.string(),
  lastUpdated: z.string(),
  documents: z.array(DocumentMetadataSchema),
});

export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;
export type MetadataFile = z.infer<typeof MetadataFileSchema>;

export interface ScoredDocument extends DocumentMetadata {
  score: number;
}

// OSS Analysis types

export type OssSource =
  | {
      type: "github";
      owner: string;
      repo: string;
      branch: string;
    }
  | {
      type: "local";
      rootPath: string;
    };

export interface FileNode {
  path: string;
  type: "file" | "dir";
}

export interface SearchResult {
  file: string;
  line: number;
  content: string;
  context: string[];
}

export interface OssAnalysis {
  name: string;
  type: "github" | "local";
  primaryLanguage: string;
  fileCount: number;
  tree: FileNode[];
  keyFiles: string[];
  summary: string;
}
