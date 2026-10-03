import type { CaseContext, DocumentType, SourceKind, SourceRef } from "@ccr/types";
import { DOCUMENT_TYPE_LABELS } from "@ccr/types";

/**
 * Assigns short, stable citation keys to every record in a case context
 * (D1 = first document by date, T3 = third timeline event, DEC2 = decision #2,
 * TK1 = first task, M4 = fourth recent message) and resolves the keys a model
 * returns back to real records.
 *
 * This is the enforcement point for "never fabricate a medical source":
 * the model can only reference keys that were present in its context; any
 * other key is dropped and counted, and quotes are verified verbatim.
 */

export interface RegistryEntry {
  key: string;
  kind: SourceKind;
  id: string;
  label: string;
  date: string | null;
  documentType: DocumentType | null;
  /** Text used to verify quoted excerpts. */
  text: string;
}

export interface ResolvedCitations {
  sources: SourceRef[];
  /** Number of citation keys returned by the model that do not exist. */
  dropped: number;
}

export interface CitationInput {
  sourceKey: string;
  quote?: string | null;
}

export class SourceRegistry {
  private readonly byKey = new Map<string, RegistryEntry>();
  private readonly byId = new Map<string, RegistryEntry>();

  constructor(ctx: CaseContext) {
    const documents = [...ctx.documents].sort(byDateThenTitle);
    documents.forEach((doc, index) =>
      this.add({
        key: `D${index + 1}`,
        kind: "document",
        id: doc.id,
        label: doc.title,
        date: doc.date,
        documentType: doc.type,
        text: doc.text,
      }),
    );

    const timeline = [...ctx.timeline].sort((a, b) => a.date.localeCompare(b.date));
    timeline.forEach((event, index) =>
      this.add({
        key: `T${index + 1}`,
        kind: "timeline",
        id: event.id,
        label: event.title,
        date: event.date,
        documentType: null,
        text: `${event.title}. ${event.description}`,
      }),
    );

    for (const decision of ctx.decisions) {
      this.add({
        key: `DEC${decision.number}`,
        kind: "decision",
        id: decision.id,
        label: `Decision #${decision.number}: ${decision.title}`,
        date: decision.createdAt.slice(0, 10),
        documentType: null,
        text: `${decision.title}. ${decision.description} ${decision.rationale} ${decision.approvals
          .map((a) => a.comment ?? "")
          .join(" ")}`,
      });
    }

    ctx.tasks.forEach((task, index) =>
      this.add({
        key: `TK${index + 1}`,
        kind: "task",
        id: task.id,
        label: task.title,
        date: task.dueDate,
        documentType: null,
        text: `${task.title}. ${task.description ?? ""}`,
      }),
    );

    ctx.messages.forEach((message, index) =>
      this.add({
        key: `M${index + 1}`,
        kind: "message",
        id: message.id,
        label: `Discussion: ${message.author}`,
        date: message.createdAt.slice(0, 10),
        documentType: null,
        text: message.content,
      }),
    );
  }

  private add(entry: RegistryEntry) {
    this.byKey.set(entry.key, entry);
    this.byId.set(entry.id, entry);
  }

  get(key: string): RegistryEntry | undefined {
    return this.byKey.get(normalizeKey(key));
  }

  getById(id: string): RegistryEntry | undefined {
    return this.byId.get(id);
  }

  keyFor(id: string): string | undefined {
    return this.byId.get(id)?.key;
  }

  entries(kind?: SourceKind): RegistryEntry[] {
    const all = [...this.byKey.values()];
    return kind ? all.filter((entry) => entry.kind === kind) : all;
  }

  /** Build a SourceRef for a known record id (used by non-LLM code paths). */
  refForId(id: string, excerpt?: string | null): SourceRef | null {
    const entry = this.byId.get(id);
    if (!entry) return null;
    return this.toRef(entry, excerpt ?? null);
  }

  /**
   * Resolve model-provided citations. Unknown keys are dropped. Duplicate keys
   * are merged (keeping the first verified excerpt). Quotes that cannot be
   * found verbatim in the source are discarded rather than shown.
   */
  resolve(citations: CitationInput[]): ResolvedCitations {
    const result = new Map<string, SourceRef>();
    let dropped = 0;

    for (const citation of citations) {
      const entry = this.get(citation.sourceKey);
      if (!entry) {
        dropped += 1;
        continue;
      }
      const quote = citation.quote?.trim() ?? "";
      const verifiedQuote = quote && verifyQuote(entry.text, quote) ? quote : null;
      const existing = result.get(entry.key);
      if (!existing) {
        result.set(entry.key, this.toRef(entry, verifiedQuote));
      } else if (!existing.excerpt && verifiedQuote) {
        result.set(entry.key, { ...existing, excerpt: verifiedQuote, verified: true });
      }
    }

    return { sources: [...result.values()], dropped };
  }

  /** Resolve a plain list of keys (no quotes). */
  resolveKeys(keys: string[]): ResolvedCitations {
    return this.resolve(keys.map((sourceKey) => ({ sourceKey })));
  }

  private toRef(entry: RegistryEntry, excerpt: string | null): SourceRef {
    return {
      kind: entry.kind,
      id: entry.id,
      label: entry.label,
      date: entry.date,
      documentType: entry.documentType,
      excerpt,
      verified: excerpt ? true : undefined,
    };
  }
}

export function describeDocumentType(type: DocumentType): string {
  return DOCUMENT_TYPE_LABELS[type];
}

function normalizeKey(key: string): string {
  return key.trim().replace(/^\[|\]$/g, "").toUpperCase();
}

function byDateThenTitle(a: { date: string; title: string }, b: { date: string; title: string }) {
  return a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
}

/** Normalize text for verbatim-quote comparison. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the quote appears verbatim (modulo whitespace, case and
 * typographic punctuation) in the source text. Quotes containing an ellipsis
 * are checked fragment by fragment, in order. Very short quotes are rejected
 * because they carry no evidential weight.
 */
export function verifyQuote(sourceText: string, quote: string): boolean {
  const haystack = normalizeForMatch(sourceText);
  const fragments = normalizeForMatch(quote)
    .replace(/^["']|["']$/g, "")
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((fragment) => fragment.replace(/[.;,]$/, "").trim())
    .filter(Boolean);
  if (fragments.length === 0) return false;
  const totalLength = fragments.reduce((sum, fragment) => sum + fragment.length, 0);
  if (totalLength < 8) return false;
  // Fragments must appear in order and must not overlap: "A … B" may not
  // stitch together a B that precedes A in the source.
  let cursor = 0;
  for (const fragment of fragments) {
    const index = haystack.indexOf(fragment, cursor);
    if (index === -1) return false;
    cursor = index + fragment.length;
  }
  return true;
}
