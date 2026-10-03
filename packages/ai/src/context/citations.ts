import type { SourceRef } from "@ccr/types";
import type { SourceRegistry } from "./source-registry";

const KEY = String.raw`(?:DEC|TK|D|T|M)\d+`;
const GROUP = new RegExp(String.raw`[\[(]\s*(?:sources?:?\s*)?(${KEY}(?:\s*[,;/]\s*${KEY})*)\s*[\])]`, "gi");

/**
 * Rewrite inline citation keys in model text ("[D3]", "(D3, T2)") as numbered
 * markers ("[1][2]") that index into the resolved `sources` list, which the UI
 * renders as clickable evidence chips. Only bracketed keys are recognized:
 * bare tokens like "D3" are ambiguous in clinical text (vitamin D3).
 *
 * Keys that do not exist in the registry are removed and counted as dropped.
 * Valid keys that the model cited inline but not in its citation list are
 * appended to the sources.
 */
export function numberInlineCitations(
  text: string,
  registry: SourceRegistry,
  sources: SourceRef[],
): { text: string; sources: SourceRef[]; dropped: number } {
  const result = [...sources];
  let dropped = 0;

  const rewritten = text.replace(GROUP, (_match, group: string) => {
    const markers: string[] = [];
    for (const rawKey of group.split(/[,;/]/)) {
      const entry = registry.get(rawKey);
      if (!entry) {
        dropped += 1;
        continue;
      }
      let index = result.findIndex((source) => source.id === entry.id);
      if (index === -1) {
        const ref = registry.refForId(entry.id);
        if (!ref) continue;
        result.push(ref);
        index = result.length - 1;
      }
      const marker = `[${index + 1}]`;
      if (!markers.includes(marker)) markers.push(marker);
    }
    return markers.join("");
  });

  return {
    text: rewritten.replace(/\s+([.,;:])/g, "$1").replace(/[ \t]{2,}/g, " ").trim(),
    sources: result,
    dropped,
  };
}
