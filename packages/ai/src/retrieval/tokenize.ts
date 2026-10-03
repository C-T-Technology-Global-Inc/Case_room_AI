/**
 * Lightweight clinical tokenizer for lexical retrieval. Lowercases, strips
 * punctuation, removes stopwords, applies naive stemming and expands a small
 * set of clinical synonyms/abbreviations so "CT" matches "computed tomography",
 * "Hb" matches "hemoglobin", etc.
 */

const STOPWORDS = new Set(
  (
    "a an and are as at be been being but by can could did do does for from had has have how i if in into is it its " +
    "me my no not of on or our she he should so than that the their them then there these they this those to was " +
    "we were what when where which while who whom why will with would you your about any all also after before " +
    "patient patients please tell show give summarize summary latest current recent regarding"
  ).split(" "),
);

const SYNONYMS: Record<string, string[]> = {
  ct: ["computed", "tomography"],
  mri: ["magnetic", "resonance"],
  pet: ["positron"],
  hb: ["hemoglobin"],
  hgb: ["hemoglobin"],
  haemoglobin: ["hemoglobin"],
  wbc: ["leukocyte", "white"],
  plt: ["platelet"],
  ca199: ["ca19", "19-9"],
  eus: ["endoscopic", "ultrasound"],
  ercp: ["cholangiopancreatography", "stent"],
  fnb: ["biopsy"],
  fna: ["biopsy"],
  bx: ["biopsy"],
  path: ["pathology"],
  onc: ["oncology"],
  chemo: ["chemotherapy"],
  surg: ["surgery", "surgical"],
  resection: ["surgery", "resectable"],
  resectability: ["resectable"],
  smv: ["mesenteric", "vein"],
  sma: ["mesenteric", "artery"],
  ef: ["ejection", "fraction"],
  bnp: ["natriuretic"],
  sob: ["dyspnea"],
  ngs: ["molecular", "sequencing"],
  anticoagulation: ["anticoag"],
  anticoagulant: ["anticoag"],
  anticoagulated: ["anticoag"],
  anticoagulants: ["anticoag"],
  enoxaparin: ["anticoag"],
  lovenox: ["anticoag", "enoxaparin"],
  heparin: ["anticoag"],
  apixaban: ["anticoag"],
  rivaroxaban: ["anticoag"],
  warfarin: ["anticoag"],
  ecog: ["performance"],
  karnofsky: ["performance"],
  allergy: ["allergies"],
  bleeding: ["bleed", "hemorrhage"],
  hemorrhage: ["bleed"],
};

export function stem(token: string): string {
  if (token.length <= 4) return token;
  return token
    .replace(/(ies)$/, "y")
    .replace(/(ations|ation|ings|ing|edly|ed|ly|es|s)$/, "")
    .replace(/(al|ic)$/, "");
}

export function tokenize(text: string, options: { expand?: boolean } = {}): string[] {
  const raw = text
    .toLowerCase()
    .replace(/ca\s*19[-\s]?9/g, " ca199 ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));

  const tokens: string[] = [];
  for (const token of raw) {
    tokens.push(stem(token));
    if (options.expand) {
      for (const synonym of SYNONYMS[token] ?? []) tokens.push(stem(synonym));
    }
  }
  return tokens;
}
