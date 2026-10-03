import { tokenize } from "./tokenize";

/**
 * Minimal BM25 index. Good enough for a single case (tens of documents).
 * The retrieval interface is deliberately small so it can later be replaced by
 * hybrid/vector retrieval without touching callers.
 */

export interface IndexedItem<T> {
  item: T;
  text: string;
}

export interface ScoredItem<T> {
  item: T;
  score: number;
}

export class BM25Index<T> {
  private readonly docs: Array<{ item: T; terms: Map<string, number>; length: number }>;
  private readonly documentFrequency = new Map<string, number>();
  private readonly averageLength: number;

  constructor(
    items: Array<IndexedItem<T>>,
    private readonly k1 = 1.4,
    private readonly b = 0.75,
  ) {
    this.docs = items.map(({ item, text }) => {
      const tokens = tokenize(text, { expand: true });
      const terms = new Map<string, number>();
      for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + 1);
      for (const term of terms.keys()) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
      return { item, terms, length: tokens.length };
    });
    const totalLength = this.docs.reduce((sum, doc) => sum + doc.length, 0);
    this.averageLength = this.docs.length ? totalLength / this.docs.length : 0;
  }

  search(query: string, limit = 5): Array<ScoredItem<T>> {
    const queryTerms = [...new Set(tokenize(query, { expand: true }))];
    if (queryTerms.length === 0 || this.docs.length === 0) return [];
    const n = this.docs.length;

    const scored = this.docs.map((doc) => {
      let score = 0;
      for (const term of queryTerms) {
        const frequency = doc.terms.get(term);
        if (!frequency) continue;
        const df = this.documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const norm = frequency + this.k1 * (1 - this.b + (this.b * doc.length) / (this.averageLength || 1));
        score += idf * ((frequency * (this.k1 + 1)) / norm);
      }
      return { item: doc.item, score };
    });

    return scored
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
