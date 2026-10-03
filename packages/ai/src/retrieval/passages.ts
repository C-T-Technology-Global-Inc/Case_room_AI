import type { CaseContext, ContextDocument } from "@ccr/types";
import { BM25Index } from "./bm25";

/**
 * Passage-level retrieval over the documents of one case.
 * Documents are split on blank lines / section headings into passages of
 * roughly `targetSize` characters, keeping the document id for citation.
 */

export interface Passage {
  documentId: string;
  documentTitle: string;
  documentDate: string;
  index: number;
  total: number;
  text: string;
}

const HEADING = /^\s*[A-Z][A-Z0-9 /&(),'+-]{2,60}:/;

export function chunkDocument(doc: ContextDocument, targetSize = 900): Passage[] {
  const blocks = doc.text
    .split(/\n\s*\n|\n(?=\s*[A-Z][A-Z0-9 /&(),'+-]{2,60}:)/)
    .map((block) => block.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    const startsSection = HEADING.test(block);
    if (current && (current.length + block.length > targetSize || (startsSection && current.length > targetSize / 3))) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n${block}` : block;
  }
  if (current) chunks.push(current);

  return chunks.map((text, index) => ({
    documentId: doc.id,
    documentTitle: doc.title,
    documentDate: doc.date,
    index,
    total: chunks.length,
    text,
  }));
}

export function retrievePassages(ctx: CaseContext, query: string, limit = 8) {
  const passages = ctx.documents.flatMap((doc) => chunkDocument(doc));
  const index = new BM25Index(
    passages.map((passage) => ({ item: passage, text: `${passage.documentTitle}\n${passage.text}` })),
  );
  return index.search(query, limit);
}

export function totalDocumentChars(ctx: CaseContext): number {
  return ctx.documents.reduce((sum, doc) => sum + doc.text.length, 0);
}
