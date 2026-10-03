import { describe, expect, it } from "vitest";
import { syntheticCase } from "../test/fixtures";
import { numberInlineCitations } from "./citations";
import { SourceRegistry, verifyQuote } from "./source-registry";

describe("SourceRegistry (source grounding)", () => {
  const registry = new SourceRegistry(syntheticCase());

  it("assigns stable keys by kind and date", () => {
    expect(registry.get("D1")?.id).toBe("doc-ct");
    expect(registry.get("d4")?.id).toBe("doc-nursing");
    expect(registry.get("[DEC1]")?.kind).toBe("decision");
    expect(registry.get("T1")?.kind).toBe("timeline");
    expect(registry.keyFor("doc-path")).toBe("D3");
  });

  it("drops citations to records that do not exist", () => {
    const { sources, dropped } = registry.resolve([{ sourceKey: "D1" }, { sourceKey: "D99" }, { sourceKey: "X5" }]);
    expect(sources.map((s) => s.id)).toEqual(["doc-ct"]);
    expect(dropped).toBe(2);
  });

  it("keeps only quotes that appear verbatim in the source", () => {
    const { sources } = registry.resolve([
      { sourceKey: "D3", quote: "Invasive adenocarcinoma, moderately differentiated" },
      { sourceKey: "D1", quote: "The tumor has spread to the liver" },
    ]);
    const pathology = sources.find((s) => s.id === "doc-path");
    const ct = sources.find((s) => s.id === "doc-ct");
    expect(pathology?.excerpt).toBe("Invasive adenocarcinoma, moderately differentiated");
    expect(pathology?.verified).toBe(true);
    expect(ct?.excerpt).toBeNull();
  });

  it("merges duplicate citations of the same record", () => {
    const { sources } = registry.resolve([{ sourceKey: "D2" }, { sourceKey: "D2", quote: "CA 19-9 is elevated." }]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.excerpt).toBe("CA 19-9 is elevated.");
  });
});

describe("verifyQuote", () => {
  const text = "Tumor contacts the superior mesenteric artery (SMA) over approximately 120 degrees.";
  it("ignores case, whitespace and typographic quotes", () => {
    expect(verifyQuote(text, "tumor   contacts the SUPERIOR mesenteric artery")).toBe(true);
  });
  it("checks fragments separated by an ellipsis", () => {
    expect(verifyQuote(text, "Tumor contacts … over approximately 120 degrees")).toBe(true);
    expect(verifyQuote(text, "Tumor contacts … over approximately 270 degrees")).toBe(false);
  });
  it("requires fragments in source order (no reordered stitching)", () => {
    const source = "Allergy: penicillin. Medication: aspirin.";
    expect(verifyQuote(source, "Allergy: … aspirin")).toBe(true);
    expect(verifyQuote(source, "Medication: … penicillin")).toBe(false);
    expect(verifyQuote(source, "penicillin … penicillin")).toBe(false);
  });
  it("rejects trivially short quotes", () => {
    expect(verifyQuote(text, "SMA")).toBe(false);
  });
});

describe("numberInlineCitations", () => {
  const registry = new SourceRegistry(syntheticCase());
  it("renumbers bracketed keys and removes fabricated ones", () => {
    const initial = registry.resolveKeys(["D3"]).sources;
    const result = numberInlineCitations("Pathology confirms cancer [D3]. CT shows involvement [D1, D42].", registry, initial);
    expect(result.text).toBe("Pathology confirms cancer [1]. CT shows involvement [2].");
    expect(result.sources.map((s) => s.id)).toEqual(["doc-path", "doc-ct"]);
    expect(result.dropped).toBe(1);
  });
  it("does not treat unbracketed tokens such as vitamin D3 as citations", () => {
    const result = numberInlineCitations("Continue vitamin D3 supplementation.", registry, []);
    expect(result.text).toBe("Continue vitamin D3 supplementation.");
    expect(result.sources).toHaveLength(0);
  });
});
