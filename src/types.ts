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
