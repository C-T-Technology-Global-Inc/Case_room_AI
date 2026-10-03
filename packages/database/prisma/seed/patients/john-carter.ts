import type { AIAnswerMetadata, CaseSummaryContent, SectionsContent, TimelineEventType } from "@ccr/types";
import type { ClinicalDocument } from "../../../src/generated/prisma/client";
import { SYNTHETIC_HEADER, at, audit, day, dobForAge, docRef, fmt, json, type SeedContext } from "../helpers";
import { buildSeedMemory } from "../memory";

/**
 * Flagship demo case: John Carter, 56, pancreatic adenocarcinoma.
 * Tumor board preparation with a pending multidisciplinary decision, plus an
 * inpatient course (cholangitis, ERCP, falling hemoglobin) that makes the
 * handoff feature meaningful.
 */
export async function seedJohnCarter(ctx: SeedContext) {
  const { prisma, org, users } = ctx;
  const u = (key: string) => users[key]!;

  const patient = await prisma.patient.create({
    data: {
      syntheticMedicalRecordNumber: "SYN-100231",
      firstName: "John",
      lastName: "Carter",
      dateOfBirth: dobForAge(56, 5, 3),
      sex: "MALE",
      primaryDiagnosis: "Pancreatic adenocarcinoma",
      status: "IN_TREATMENT",
      organizationId: org.id,
      createdAt: at(17, "08:35"),
    },
  });

  const room = await prisma.caseRoom.create({
    data: {
      patientId: patient.id,
      organizationId: org.id,
      title: "Pancreatic head mass: tumor board work-up",
      specialty: "ONCOLOGY",
      status: "DECISION_PENDING",
      createdById: u("nguyen").id,
      createdAt: at(17, "08:40"),
    },
  });
  const caseRoomId = room.id;

  await audit(ctx, { caseRoomId, userId: u("nguyen").id, action: "case.created", resourceType: "CaseRoom", resourceId: caseRoomId, metadata: { title: room.title, patient: "John Carter" }, createdAt: at(17, "08:40") });

  const members: Array<[string, number, string]> = [
    ["nguyen", 17, "08:40"],
    ["lee", 17, "08:41"],
    ["rivera", 17, "08:41"],
    ["patel", 14, "10:05"],
    ["smith", 10, "09:30"],
    ["obrien", 9, "11:00"],
    ["adams", 5, "07:00"],
  ];
  for (const [key, days, time] of members) {
    await prisma.caseRoomMember.create({
      data: { caseRoomId, userId: u(key).id, addedById: key === "nguyen" ? null : u("nguyen").id, joinedAt: at(days, time) },
    });
    if (key !== "nguyen") {
      await audit(ctx, { caseRoomId, userId: u("nguyen").id, action: "case.member_added", resourceType: "User", resourceId: u(key).id, metadata: { memberName: u(key).name, specialty: u(key).specialty }, createdAt: at(days, time) });
    }
  }

  // ── Documents ────────────────────────────────────────────────────────────
  const documents: Array<{
    key: string;
    type: ClinicalDocument["type"];
    title: string;
    days: number;
    uploadedBy: string;
    time: string;
    text: string;
  }> = [
    {
      key: "ct",
      type: "IMAGING_REPORT",
      title: "CT Abdomen/Pelvis, pancreatic protocol",
      days: 18,
      uploadedBy: "lee",
      time: "16:20",
      text: `${SYNTHETIC_HEADER}

RADIOLOGY REPORT
EXAM: CT abdomen and pelvis with IV contrast, pancreatic protocol (arterial and portal venous phases)
DATE OF EXAM: ${fmt(day(18))}
PATIENT: John Carter | MRN: SYN-100231
ORDERING PROVIDER: Dr. Alan Whitfield (Primary Care)

CLINICAL HISTORY: 56-year-old man with 3 months of epigastric pain radiating to the back, 7 kg unintentional weight loss and new painless jaundice.

TECHNIQUE: Multiphasic CT of the abdomen and pelvis after 100 mL IV iohexol. Coronal and sagittal reformats.

COMPARISON: None.

FINDINGS:
Pancreas: 3.4 x 2.8 cm ill-defined hypoenhancing mass in the pancreatic head and uncinate process. Upstream main pancreatic duct dilated to 6 mm with atrophy of the body and tail.
Vessels: The mass contacts the superior mesenteric vein (SMV) and SMV-portal vein confluence over approximately 220 degrees with short-segment narrowing and contour irregularity. Tumor contacts the superior mesenteric artery (SMA) over approximately 120 degrees without luminal narrowing. Celiac axis and common hepatic artery are free of tumor. No venous thrombosis.
Biliary: Common bile duct dilated to 13 mm, abruptly tapering at the level of the mass. Intrahepatic biliary dilatation.
Liver: No focal hepatic lesion suspicious for metastasis.
Lymph nodes: Two borderline peripancreatic lymph nodes, largest 9 mm short axis.
Peritoneum: No ascites. No peritoneal nodularity.

IMPRESSION:
1. 3.4 cm hypoenhancing pancreatic head mass, highly suspicious for pancreatic adenocarcinoma.
2. Vascular involvement: greater than 180 degrees SMV-portal vein contact with short-segment narrowing, and 90-180 degrees SMA contact. Findings are at least borderline resectable and may represent locally advanced disease; multidisciplinary review recommended.
3. Biliary obstruction with common bile duct dilatation to 13 mm.
4. No evidence of hepatic or peritoneal metastatic disease.

Electronically signed: Dr. Daniel Lee, Radiology`,
    },
    {
      key: "labs1",
      type: "LAB_RESULT",
      title: "Laboratory panel: tumor markers and liver function",
      days: 16,
      uploadedBy: "nguyen",
      time: "13:05",
      text: `${SYNTHETIC_HEADER}

LABORATORY REPORT
COLLECTED: ${fmt(day(16))} 08:15
PATIENT: John Carter | MRN: SYN-100231
ORDERING PROVIDER: Dr. Minh Nguyen (Medical Oncology)

RESULTS:
TEST                      RESULT      UNITS      REFERENCE      FLAG
CA 19-9                   1,240       U/mL       0-37           H
CEA                       6.1         ng/mL      0.0-3.0        H
Total bilirubin           3.8         mg/dL      0.2-1.2        H
Direct bilirubin          2.9         mg/dL      0.0-0.3        H
Alkaline phosphatase      412         U/L        40-129         H
ALT                       96          U/L        7-56           H
AST                       78          U/L        10-40          H
Albumin                   3.4         g/dL       3.5-5.0        L
Hemoglobin                13.1        g/dL       13.5-17.5      L
White blood cells         7.2         x10^3/uL   4.0-11.0
Platelets                 245         x10^3/uL   150-400
Creatinine                0.9         mg/dL      0.7-1.3
HbA1c                     6.6         %          4.0-5.6        H

INTERPRETATION:
CA 19-9 is markedly elevated. CA 19-9 can be falsely elevated in the setting of biliary obstruction; consider repeating after biliary decompression. Cholestatic liver enzyme pattern consistent with biliary obstruction.`,
    },
    {
      key: "eus",
      type: "CLINICAL_NOTE",
      title: "EUS-guided fine-needle biopsy: procedure note",
      days: 14,
      uploadedBy: "rivera",
      time: "15:40",
      text: `${SYNTHETIC_HEADER}

PROCEDURE NOTE: ENDOSCOPIC ULTRASOUND WITH FINE-NEEDLE BIOPSY
DATE OF PROCEDURE: ${fmt(day(14))}
ENDOSCOPIST: Dr. Sofia Alvarez, Gastroenterology
INDICATION: Pancreatic head mass on CT with biliary obstruction; tissue diagnosis.

FINDINGS:
A 3.3 x 2.9 cm irregular hypoechoic mass was identified in the pancreatic head. The mass abuts the SMV-portal vein confluence with loss of the interface over a segment of approximately 2 cm. The SMA interface appeared preserved on endosonographic views. The common bile duct was dilated to 12 mm. No ascites.

INTERVENTION:
EUS-guided fine-needle biopsy (FNB) of the pancreatic head mass was performed using a 22-gauge FNB needle, 3 passes. Rapid on-site evaluation showed adequate cellularity with atypical glandular cells.

COMPLICATIONS: None.

IMPRESSION:
Pancreatic head mass with SMV-portal vein confluence abutment. EUS-FNB performed; tissue adequate on rapid on-site evaluation. Final pathology to follow.

RECOMMENDATIONS:
- Follow up final pathology.
- ERCP with biliary drainage if bilirubin rises or cholangitis develops.
- Discuss at multidisciplinary tumor board.`,
    },
    {
      key: "path",
      type: "PATHOLOGY_REPORT",
      title: "Surgical pathology: pancreatic head biopsy",
      days: 12,
      uploadedBy: "patel",
      time: "14:30",
      text: `${SYNTHETIC_HEADER}

SURGICAL PATHOLOGY REPORT
ACCESSION: SYN-S26-04417
SPECIMEN: Pancreas, head mass, EUS-guided fine-needle biopsy
DATE RECEIVED: ${fmt(day(14))}
DATE REPORTED: ${fmt(day(12))}
PATHOLOGIST: Dr. Priya Patel

FINAL DIAGNOSIS:
Pancreas, head mass, EUS-guided fine-needle biopsy: Invasive adenocarcinoma, moderately differentiated, consistent with pancreatic ductal adenocarcinoma.

MICROSCOPIC DESCRIPTION:
Cores of desmoplastic stroma infiltrated by irregular, angulated malignant glands with moderate nuclear pleomorphism and occasional mitoses. No neuroendocrine or acinar component identified. Tumor comprises approximately 40% of submitted tissue.

IMMUNOHISTOCHEMISTRY:
CK7 positive. CK19 positive. CK20 negative. CDX2 focally positive. SMAD4 (DPC4) expression lost in tumor cells. Synaptophysin and chromogranin negative.

COMMENT:
The morphology and immunoprofile support pancreatic ductal adenocarcinoma. Tissue quantity is adequate for molecular testing. Recommend next-generation sequencing (including KRAS, BRCA1/2, PALB2, mismatch repair/MSI status and NTRK fusions) and germline genetic testing, per institutional protocol.`,
    },
    {
      key: "onc",
      type: "CLINICAL_NOTE",
      title: "Medical oncology consultation",
      days: 10,
      uploadedBy: "nguyen",
      time: "17:10",
      text: `${SYNTHETIC_HEADER}

MEDICAL ONCOLOGY CONSULTATION
DATE OF SERVICE: ${fmt(day(10))}
PHYSICIAN: Dr. Minh Nguyen, Medical Oncology
REFERRING: Dr. Alan Whitfield, Primary Care

REASON FOR CONSULTATION: Newly diagnosed pancreatic adenocarcinoma.

HISTORY OF PRESENT ILLNESS:
Mr. Carter is a 56-year-old man who presented with three months of epigastric pain radiating to the back, 7 kg unintentional weight loss and jaundice. CT showed a 3.4 cm pancreatic head mass with SMV-portal vein involvement and SMA contact. EUS-guided biopsy confirmed moderately differentiated pancreatic ductal adenocarcinoma. CA 19-9 was 1,240 U/mL in the setting of biliary obstruction.

PAST MEDICAL HISTORY: Hypertension. Hyperlipidemia. New hyperglycemia (HbA1c 6.6%).
MEDICATIONS: Lisinopril 10 mg daily. Atorvastatin 20 mg daily. Oxycodone 5 mg every 6 hours as needed for pain.
ALLERGIES: No known drug allergies.
SOCIAL HISTORY: Married, two adult children. Works as an electrician. Former smoker, 20 pack-years, quit 8 years ago.
FAMILY HISTORY: Mother with breast cancer at age 49. No known family history of pancreatic cancer.

PHYSICAL EXAMINATION: Scleral icterus. Mild epigastric tenderness. No palpable adenopathy.
PERFORMANCE STATUS: ECOG 1.

ASSESSMENT AND PLAN:
56-year-old man with pancreatic ductal adenocarcinoma of the head, with vascular involvement that is at least borderline resectable and possibly locally advanced (SMV-PV contact over 180 degrees, SMA contact 90-180 degrees). No distant metastases on CT. ECOG 1.
1. Present at multidisciplinary tumor board to confirm resectability classification.
2. Favor neoadjuvant systemic chemotherapy (for example FOLFIRINOX, if performance status and biliary drainage allow) followed by restaging and surgical re-evaluation, pending tumor board and surgical opinion.
3. Biliary drainage required before chemotherapy given bilirubin 3.8 mg/dL.
4. Order next-generation sequencing on tumor tissue; refer for germline genetic counseling and testing (maternal history of early breast cancer).
5. Nutrition referral for weight loss.
6. Port placement once treatment plan confirmed.

QUESTIONS FOR TUMOR BOARD:
1. Is the tumor surgically resectable, borderline resectable or locally advanced?
2. Should neoadjuvant chemotherapy be initiated before surgical re-evaluation?
3. Is additional molecular testing required before treatment selection?`,
    },
    {
      key: "surg",
      type: "CLINICAL_NOTE",
      title: "Surgical oncology consultation",
      days: 8,
      uploadedBy: "smith",
      time: "16:05",
      text: `${SYNTHETIC_HEADER}

SURGICAL ONCOLOGY CONSULTATION
DATE OF SERVICE: ${fmt(day(8))}
SURGEON: Dr. Emily Smith, Surgical Oncology

REASON FOR CONSULTATION: Evaluation of resectability of pancreatic head adenocarcinoma.

HISTORY OF PRESENT ILLNESS:
56-year-old man with biopsy-proven pancreatic ductal adenocarcinoma of the head. Imaging reviewed personally with radiology.

IMAGING REVIEW:
CT demonstrates SMV-portal vein confluence involvement over approximately 220 degrees with short-segment narrowing, which appears reconstructible. SMA contact of approximately 120 degrees. No hepatic or peritoneal metastases.

ASSESSMENT:
Borderline resectable pancreatic head adenocarcinoma based on venous involvement and SMA contact under 180 degrees. Not a candidate for upfront resection because of the SMA contact and the high risk of a margin-positive resection.

RECOMMENDATIONS:
- Neoadjuvant therapy prior to any operative planning.
- Restaging pancreatic-protocol CT after completion of neoadjuvant chemotherapy (approximately 2-3 months).
- Re-evaluate for pancreaticoduodenectomy with possible venous resection and reconstruction if there is no progression.
- Patient and wife counseled; they understand that surgery is not planned at this time.`,
    },
    {
      key: "hp",
      type: "CLINICAL_NOTE",
      title: "Hospital admission H&P: acute cholangitis",
      days: 5,
      uploadedBy: "adams",
      time: "06:50",
      text: `${SYNTHETIC_HEADER}

HOSPITAL ADMISSION HISTORY AND PHYSICAL
DATE OF ADMISSION: ${fmt(day(5))}
ADMITTING PHYSICIAN: Dr. Kevin Park, Hospital Medicine

CHIEF COMPLAINT: Fever, chills and right upper quadrant pain.

HISTORY OF PRESENT ILLNESS:
Mr. Carter, with recently diagnosed pancreatic ductal adenocarcinoma awaiting biliary drainage and neoadjuvant therapy, presented to the emergency department with 24 hours of fever to 38.9 C, rigors and worsening right upper quadrant pain. He reports darker urine and pruritus.

VITAL SIGNS: T 38.9 C, HR 108, BP 104/66, RR 20, SpO2 96% on room air.
LABORATORY: WBC 14.2 x10^3/uL, total bilirubin 6.2 mg/dL, lactate 2.4 mmol/L, hemoglobin 12.8 g/dL, creatinine 1.1 mg/dL.

ASSESSMENT:
Acute cholangitis secondary to malignant biliary obstruction from pancreatic head adenocarcinoma. Early sepsis physiology, hemodynamically stable after fluids.

PLAN:
- Blood cultures x2 drawn before antibiotics.
- IV piperacillin-tazobactam.
- IV fluids; monitor lactate.
- Gastroenterology consulted for urgent ERCP with biliary decompression.
- Enoxaparin 40 mg subcutaneous daily for VTE prophylaxis, hold on the morning of ERCP.
- Oncology (Dr. Nguyen) notified.`,
    },
    {
      key: "ercp",
      type: "CLINICAL_NOTE",
      title: "ERCP with biliary stent placement: procedure note",
      days: 4,
      uploadedBy: "adams",
      time: "15:30",
      text: `${SYNTHETIC_HEADER}

PROCEDURE NOTE: ENDOSCOPIC RETROGRADE CHOLANGIOPANCREATOGRAPHY (ERCP)
DATE OF PROCEDURE: ${fmt(day(4))}
ENDOSCOPIST: Dr. Sofia Alvarez, Gastroenterology
INDICATION: Acute cholangitis with malignant distal biliary obstruction.

FINDINGS:
A 2.5 cm distal common bile duct stricture was seen with upstream dilatation. Purulent bile was drained on cannulation.

INTERVENTION:
Biliary sphincterotomy was performed. A 10 mm x 60 mm fully covered self-expanding metal biliary stent was placed across the stricture with good drainage of bile and contrast. Mild oozing from the sphincterotomy site was controlled with epinephrine injection.

COMPLICATIONS: Mild post-sphincterotomy bleeding, controlled endoscopically.

IMPRESSION:
Malignant distal biliary stricture. Successful sphincterotomy and fully covered metal stent placement. Mild post-sphincterotomy bleeding controlled.

RECOMMENDATIONS:
- Continue antibiotics; follow blood cultures.
- Monitor hemoglobin every 12 hours for 24 hours given sphincterotomy bleeding.
- Resume enoxaparin prophylaxis in 24 hours if no evidence of bleeding.
- Clear liquid diet, advance as tolerated.`,
    },
    {
      key: "labs2",
      type: "LAB_RESULT",
      title: "Inpatient labs and blood cultures",
      days: 2,
      uploadedBy: "adams",
      time: "07:10",
      text: `${SYNTHETIC_HEADER}

LABORATORY REPORT
COLLECTED: ${fmt(day(2))} 05:40
PATIENT: John Carter | MRN: SYN-100231
LOCATION: Inpatient, Ward 6B

RESULTS:
TEST                      RESULT      UNITS      REFERENCE      FLAG
Hemoglobin                10.4        g/dL       13.5-17.5      L
White blood cells         11.8        x10^3/uL   4.0-11.0       H
Platelets                 198         x10^3/uL   150-400
Total bilirubin           2.1         mg/dL      0.2-1.2        H
Lactate                   1.3         mmol/L     0.5-2.0
Creatinine                1.0         mg/dL      0.7-1.3
INR                       1.1                    0.8-1.2

MICROBIOLOGY:
Blood cultures (collected on admission): Gram-negative rods in 1 of 2 bottles. Identification and susceptibilities pending.

INTERPRETATION:
Hemoglobin decreased from 12.8 g/dL on admission. Bilirubin improving after biliary stent placement. Leukocytosis improving.`,
    },
    {
      key: "nursing",
      type: "CLINICAL_NOTE",
      title: "Nursing shift note (night)",
      days: 1,
      uploadedBy: "adams",
      time: "06:55",
      text: `${SYNTHETIC_HEADER}

NURSING SHIFT NOTE (NIGHT SHIFT 19:00-07:00)
DATE: ${fmt(day(1))}
NURSE: Rachel Adams, RN
LOCATION: Ward 6B, Bed 12

SITUATION:
Patient reports increased abdominal pain overnight, 6/10 (was 3/10 at start of shift), epigastric, not relieved by oxycodone 5 mg. One episode of dark stool at 04:30.

BACKGROUND:
Admitted with acute cholangitis; ERCP with sphincterotomy and metal biliary stent 3 days ago with mild post-sphincterotomy bleeding. On IV piperacillin-tazobactam. Enoxaparin prophylaxis resumed yesterday.

ASSESSMENT:
Hemodynamically stable: BP 118/72, HR 96, T 37.4 C, SpO2 97% on room air. Morning hemoglobin 9.6 g/dL (10.4 g/dL yesterday, 12.8 g/dL on admission). Abdomen soft, tender in epigastrium. Stool sent for occult blood.

ACTIONS TAKEN:
- Dr. Nguyen notified at 05:10 of hemoglobin drop and increased pain.
- Enoxaparin held per Dr. Nguyen pending evaluation.
- CT abdomen with contrast ordered to evaluate for post-ERCP bleeding or other complication.
- Type and screen sent.

PENDING:
- CT abdomen result.
- Blood culture identification and susceptibilities.
- Stool occult blood result.

RISKS:
- Bleeding: falling hemoglobin after sphincterotomy, recent anticoagulant prophylaxis.
- Infection: bacteremia with gram-negative rods on antibiotics.
- Falls: opioid analgesia, deconditioning.

RECOMMENDATIONS FOR NEXT SHIFT:
- Review CT abdomen result with the team.
- Repeat CBC at 12:00; notify physician if hemoglobin is below 8.0 g/dL or if there is hemodynamic instability.
- Keep enoxaparin on hold until reviewed by the physician.
- Reassess pain every 2 hours.`,
    },
  ];

  const docs: Record<string, ClinicalDocument> = {};
  for (const spec of documents) {
    const uploadedAt = at(spec.days, spec.time);
    const doc = await prisma.clinicalDocument.create({
      data: {
        caseRoomId,
        type: spec.type,
        title: spec.title,
        rawText: spec.text,
        uploadedById: u(spec.uploadedBy).id,
        documentDate: day(spec.days),
        createdAt: uploadedAt,
        processingStatus: "COMPLETED",
        processedAt: new Date(uploadedAt.getTime() + 20_000),
        fileName: `${spec.key}.txt`,
        mimeType: "text/plain",
        fileSize: Buffer.byteLength(spec.text),
      },
    });
    docs[spec.key] = doc;
    await audit(ctx, { caseRoomId, userId: u(spec.uploadedBy).id, action: "document.uploaded", resourceType: "ClinicalDocument", resourceId: doc.id, metadata: { title: doc.title, documentType: doc.type }, createdAt: uploadedAt });
    await audit(ctx, { caseRoomId, userId: u(spec.uploadedBy).id, actorType: "AI", action: "ai.document_processed", resourceType: "ClinicalDocument", resourceId: doc.id, metadata: { title: doc.title, timelineEvents: 1, provider: "demo-seed" }, createdAt: new Date(uploadedAt.getTime() + 20_000) });
  }
  const d = (key: string) => docs[key]!;

  // ── Timeline ─────────────────────────────────────────────────────────────
  const timeline: Array<[number, TimelineEventType, string, string, string | null]> = [
    [18, "IMAGING", "CT identifies pancreatic head mass", "3.4 cm hypoenhancing pancreatic head mass with >180° SMV-portal vein contact and 90-180° SMA contact; biliary dilatation; no liver or peritoneal metastases.", "ct"],
    [16, "LAB", "CA 19-9 elevated", "CA 19-9 1,240 U/mL (H), CEA 6.1 ng/mL (H); cholestatic pattern with total bilirubin 3.8 mg/dL.", "labs1"],
    [14, "PROCEDURE", "EUS-guided biopsy performed", "EUS-FNB of 3.3 cm pancreatic head mass abutting the SMV-portal vein confluence; tissue adequate on rapid on-site evaluation.", "eus"],
    [12, "PATHOLOGY", "Pathology confirms adenocarcinoma", "Invasive, moderately differentiated pancreatic ductal adenocarcinoma with SMAD4 loss; tissue adequate for NGS.", "path"],
    [10, "CONSULTATION", "Medical oncology consultation", "ECOG 1. Favors neoadjuvant chemotherapy after biliary drainage, pending tumor board; NGS and germline testing recommended.", "onc"],
    [8, "CONSULTATION", "Surgical oncology consultation", "Borderline resectable; not a candidate for upfront resection because of SMA contact. Re-evaluate after neoadjuvant therapy.", "surg"],
    [5, "ADMISSION", "Admitted with acute cholangitis", "Fever 38.9 C, total bilirubin 6.2 mg/dL, WBC 14.2; blood cultures drawn, IV piperacillin-tazobactam started.", "hp"],
    [4, "PROCEDURE", "ERCP with metal biliary stent", "Sphincterotomy and fully covered metal stent across a 2.5 cm distal CBD stricture; mild post-sphincterotomy bleeding controlled.", "ercp"],
    [2, "LAB", "Hemoglobin decreased; blood cultures positive", "Hemoglobin 10.4 g/dL (12.8 on admission); bilirubin improving to 2.1 mg/dL; gram-negative rods in 1 of 2 blood culture bottles.", "labs2"],
    [1, "NOTE", "Increased abdominal pain, hemoglobin 9.6 g/dL", "Pain 6/10 with one dark stool overnight; enoxaparin held; CT abdomen ordered.", "nursing"],
  ];
  for (const [days, eventType, title, description, docKey] of timeline) {
    await prisma.timelineEvent.create({
      data: {
        caseRoomId,
        date: day(days),
        eventType,
        title,
        description,
        sourceDocumentId: docKey ? d(docKey).id : null,
        createdByAI: true,
        createdAt: new Date(at(days, "12:00").getTime()),
      },
    });
  }

  // ── Discussion ───────────────────────────────────────────────────────────
  const message = async (
    authorKey: string | null,
    type: "USER" | "AI" | "SYSTEM",
    content: string,
    createdAt: Date,
    metadata?: unknown,
  ) =>
    prisma.message.create({
      data: {
        caseRoomId,
        authorId: authorKey ? u(authorKey).id : null,
        type,
        content,
        createdAt,
        metadata: metadata === undefined ? undefined : json(metadata),
      },
    });
  const userMeta = (mentioned: string[] = [], mentionsAI = false) => ({
    kind: "user",
    mentionedUserIds: mentioned.map((k) => u(k).id),
    mentionsAI,
  });
  const aiMeta = (
    question: string,
    questionMessageId: string,
    requestedBy: string,
    fields: Pick<AIAnswerMetadata, "sources" | "confidence" | "limitations">,
  ): AIAnswerMetadata => ({
    kind: "ai_answer",
    question,
    questionMessageId,
    requestedById: u(requestedBy).id,
    provider: "demo-seed",
    model: "seed",
    droppedCitations: 0,
    latencyMs: 2400,
    ...fields,
  });

  await message(null, "SYSTEM", "Dr. Minh Nguyen created this case room.", at(17, "08:40"), { kind: "system", event: "case.created" });
  await message("nguyen", "USER", "Welcome, everyone. New referral: 56M with a pancreatic head mass on CT and painless jaundice. CT is uploaded and labs will follow. @DrLee could you take a look at the vascular involvement?", at(17, "08:46"), userMeta(["lee"]));
  await message("lee", "USER", "Reviewed. More than 180° SMV-PV contact with short-segment narrowing and roughly 120° SMA contact. No liver or peritoneal disease. At least borderline resectable; this needs surgical input.", at(17, "11:20"), userMeta());

  const q1 = await message("nguyen", "USER", "@AI summarize the pathology findings.", at(12, "15:05"), userMeta([], true));
  await audit(ctx, { caseRoomId, userId: u("nguyen").id, action: "ai.question_asked", resourceType: "Message", resourceId: q1.id, metadata: { question: "summarize the pathology findings" }, createdAt: at(12, "15:05") });
  const a1 = await message(
    null,
    "AI",
    "The EUS-guided biopsy confirms invasive adenocarcinoma, moderately differentiated, consistent with pancreatic ductal adenocarcinoma [1]. Immunohistochemistry shows loss of SMAD4 (DPC4) expression [1]. The pathologist notes the tissue is adequate for molecular testing and recommends next-generation sequencing (KRAS, BRCA1/2, PALB2, MMR/MSI, NTRK) and germline genetic testing [1].",
    new Date(at(12, "15:05").getTime() + 18_000),
    aiMeta("summarize the pathology findings", q1.id, "nguyen", {
      sources: [docRef(d("path"), "Invasive adenocarcinoma, moderately differentiated, consistent with pancreatic ductal adenocarcinoma.")],
      confidence: "high",
      limitations: "Summarizes the final pathology report only; molecular results are not yet available in the record.",
    }),
  );
  await audit(ctx, { caseRoomId, userId: u("nguyen").id, actorType: "AI", action: "ai.answer_generated", resourceType: "Message", resourceId: a1.id, metadata: { sources: 1, confidence: "high" }, createdAt: a1.createdAt });

  const q2 = await message("lee", "USER", "@AI compare this with the latest CT.", at(11, "09:12"), userMeta([], true));
  await audit(ctx, { caseRoomId, userId: u("lee").id, action: "ai.question_asked", resourceType: "Message", resourceId: q2.id, metadata: { question: "compare this with the latest CT" }, createdAt: at(11, "09:12") });
  const a2 = await message(
    null,
    "AI",
    "The pathology confirms malignancy (moderately differentiated pancreatic ductal adenocarcinoma) [1], while the CT describes a 3.4 cm hypoenhancing pancreatic head mass with greater than 180° contact of the SMV-portal vein confluence with short-segment narrowing, and 90-180° contact with the SMA [2]. The CT shows no hepatic or peritoneal metastases [2].\nTaken together, the records describe a tissue-confirmed pancreatic adenocarcinoma with significant vascular involvement. The radiologist classified it as at least borderline resectable and possibly locally advanced; the final resectability classification requires surgical review.",
    new Date(at(11, "09:12").getTime() + 21_000),
    aiMeta("compare this with the latest CT", q2.id, "lee", {
      sources: [
        docRef(d("path"), "Invasive adenocarcinoma, moderately differentiated, consistent with pancreatic ductal adenocarcinoma."),
        docRef(d("ct"), "Vascular involvement: greater than 180 degrees SMV-portal vein contact with short-segment narrowing, and 90-180 degrees SMA contact."),
      ],
      confidence: "high",
      limitations: "Compares the two reports as documented; resectability classification is a clinical judgment for the tumor board.",
    }),
  );
  await audit(ctx, { caseRoomId, userId: u("lee").id, actorType: "AI", action: "ai.answer_generated", resourceType: "Message", resourceId: a2.id, metadata: { sources: 2, confidence: "high" }, createdAt: a2.createdAt });

  await message("patel", "USER", "Confirmed on my end. Tumor is about 40% of the submitted tissue, plenty for NGS. I'll send it out as soon as oncology places the order.", at(11, "10:30"), userMeta());
  await message("nguyen", "USER", "Given the vascular involvement I'm leaning toward neoadjuvant therapy. @DrSmith can you weigh in on resectability?", at(9, "17:40"), userMeta(["smith"]));
  await message("smith", "USER", "Saw him today. Not a candidate for upfront resection; the SMA contact is my main concern. Venous reconstruction looks feasible after neoadjuvant therapy. Consult note uploaded.", at(8, "16:10"), userMeta());
  await message("obrien", "USER", "From the radiation oncology side we could consider SBRT after induction chemotherapy, depending on response. Happy to discuss options at tumor board.", at(7, "12:00"), userMeta());
  await message("adams", "USER", "FYI: he was admitted overnight with fever and RUQ pain, looks like cholangitis. Blood cultures drawn, on pip-tazo. GI is planning ERCP.", at(5, "07:30"), userMeta());
  await message("rivera", "USER", `Tumor board slot confirmed for ${fmt(day(-2))} at 07:30. I'll also get genetic counseling scheduled.`, at(4, "14:20"), userMeta());

  // ── Decision #1 ──────────────────────────────────────────────────────────
  const decision = await prisma.decision.create({
    data: {
      caseRoomId,
      number: 1,
      title: "Neoadjuvant chemotherapy before surgical re-evaluation",
      description:
        "Proceed with neoadjuvant systemic chemotherapy (regimen per medical oncology, e.g. FOLFIRINOX if performance status allows) once biliary drainage is established and cholangitis has resolved. Restage with pancreatic-protocol CT after completion (approximately 2-3 months), then re-evaluate for pancreaticoduodenectomy with possible venous reconstruction.",
      rationale:
        "Vascular involvement on CT (>180° SMV-portal vein contact with narrowing; 90-180° SMA contact) makes upfront resection unlikely to achieve negative margins. Pathology confirms moderately differentiated pancreatic ductal adenocarcinoma. No distant metastases on staging CT. ECOG 1. Surgical oncology recommends neoadjuvant therapy before any operative planning.",
      status: "UNDER_REVIEW",
      createdById: u("nguyen").id,
      createdAt: at(3, "18:05"),
      sources: {
        create: [{ documentId: d("ct").id }, { documentId: d("path").id }, { documentId: d("onc").id }, { documentId: d("surg").id }],
      },
    },
  });
  await prisma.approval.createMany({
    data: [
      { decisionId: decision.id, userId: u("lee").id, status: "APPROVED", comment: "Agree with the vascular assessment. Recommend pancreatic-protocol CT for restaging.", createdAt: at(3, "18:05"), respondedAt: at(2, "08:15") },
      { decisionId: decision.id, userId: u("patel").id, status: "APPROVED", comment: "Diagnosis confirmed. The NGS order is still outstanding; please place it so results are available for the board.", createdAt: at(3, "18:05"), respondedAt: at(2, "13:40") },
      { decisionId: decision.id, userId: u("smith").id, status: "PENDING", createdAt: at(3, "18:05") },
    ],
  });
  await prisma.timelineEvent.create({
    data: {
      caseRoomId,
      date: day(3),
      eventType: "DECISION",
      title: `Decision #${decision.number} proposed`,
      description: "Neoadjuvant chemotherapy before surgical re-evaluation, proposed by Dr. Minh Nguyen for multidisciplinary review.",
      createdByAI: false,
      createdById: u("nguyen").id,
      createdAt: at(3, "18:05"),
    },
  });
  await message(null, "SYSTEM", `Dr. Minh Nguyen proposed Decision #${decision.number}: Neoadjuvant chemotherapy before surgical re-evaluation. Reviewers: Dr. Daniel Lee, Dr. Priya Patel, Dr. Emily Smith.`, at(3, "18:05"), { kind: "system", event: "decision.proposed", refType: "decision", refId: decision.id });
  await audit(ctx, { caseRoomId, userId: u("nguyen").id, action: "decision.proposed", resourceType: "Decision", resourceId: decision.id, metadata: { number: decision.number, title: decision.title }, createdAt: at(3, "18:05") });
  await message(null, "SYSTEM", `Dr. Daniel Lee approved Decision #${decision.number}.`, at(2, "08:15"), { kind: "system", event: "decision.approved", refType: "decision", refId: decision.id });
  await audit(ctx, { caseRoomId, userId: u("lee").id, action: "decision.approved", resourceType: "Decision", resourceId: decision.id, metadata: { number: decision.number, title: decision.title, comment: "Agree with the vascular assessment." }, createdAt: at(2, "08:15") });
  await message(null, "SYSTEM", `Dr. Priya Patel approved Decision #${decision.number}.`, at(2, "13:40"), { kind: "system", event: "decision.approved", refType: "decision", refId: decision.id });
  await audit(ctx, { caseRoomId, userId: u("patel").id, action: "decision.approved", resourceType: "Decision", resourceId: decision.id, metadata: { number: decision.number, title: decision.title }, createdAt: at(2, "13:40") });

  await message("adams", "USER", "Hb is down to 9.6 this morning and pain is worse (6/10), one dark stool. Dr. Nguyen is aware: enoxaparin on hold, CT abdomen ordered.", at(1, "05:25"), userMeta());

  const q3 = await message("nguyen", "USER", "@AI what are the current risks we should watch overnight?", at(1, "06:10"), userMeta([], true));
  await audit(ctx, { caseRoomId, userId: u("nguyen").id, action: "ai.question_asked", resourceType: "Message", resourceId: q3.id, metadata: { question: "what are the current risks we should watch overnight?" }, createdAt: at(1, "06:10") });
  const a3 = await message(
    null,
    "AI",
    "Documented risks to watch:\n- Bleeding: hemoglobin has fallen from 12.8 g/dL on admission to 10.4 g/dL and 9.6 g/dL this morning after sphincterotomy, with one dark stool overnight [1][2]. Mild post-sphincterotomy bleeding was noted at ERCP [3].\n- Anticoagulation: enoxaparin prophylaxis is currently held pending physician evaluation [1].\n- Infection: blood cultures grew gram-negative rods in 1 of 2 bottles; identification and susceptibilities are pending, and he remains on IV piperacillin-tazobactam [2][1].\n- Pain: abdominal pain increased to 6/10 overnight; a CT abdomen has been ordered to evaluate for post-ERCP complications [1].\nThe nursing plan is to repeat the CBC at 12:00 and notify the physician if hemoglobin is below 8.0 g/dL or if there is hemodynamic instability [1].",
    new Date(at(1, "06:10").getTime() + 24_000),
    aiMeta("what are the current risks we should watch overnight?", q3.id, "nguyen", {
      sources: [
        docRef(d("nursing"), "Morning hemoglobin 9.6 g/dL (10.4 g/dL yesterday, 12.8 g/dL on admission)."),
        docRef(d("labs2"), "Gram-negative rods in 1 of 2 bottles."),
        docRef(d("ercp"), "Mild post-sphincterotomy bleeding, controlled endoscopically."),
      ],
      confidence: "high",
      limitations: "Lists risks documented by the team; it is not a clinical risk assessment. CT results are not yet available.",
    }),
  );
  await audit(ctx, { caseRoomId, userId: u("nguyen").id, actorType: "AI", action: "ai.answer_generated", resourceType: "Message", resourceId: a3.id, metadata: { sources: 3, confidence: "high" }, createdAt: a3.createdAt });
  await message("nguyen", "USER", `Thanks. @DrLee please prioritize the CT read today. @DrSmith we still need your review on Decision #${decision.number} before tumor board.`, at(1, "06:14"), userMeta(["lee", "smith"]));

  // ── Tasks ────────────────────────────────────────────────────────────────
  const tasks: Array<{
    title: string;
    description: string;
    assignee: string;
    creator: string;
    status: "TODO" | "IN_PROGRESS" | "DONE";
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    due: number;
    created: [number, string];
    completed?: [number, string];
  }> = [
    { title: "Place order for NGS on tumor tissue", description: "Pathology confirms tissue is adequate. Order next-generation sequencing (KRAS, BRCA1/2, PALB2, MMR/MSI, NTRK).", assignee: "nguyen", creator: "patel", status: "TODO", priority: "HIGH", due: 1, created: [11, "10:32"] },
    { title: "Germline genetic counseling referral", description: "Maternal history of breast cancer at 49. Schedule genetic counseling and germline testing.", assignee: "rivera", creator: "nguyen", status: "IN_PROGRESS", priority: "MEDIUM", due: -5, created: [10, "17:20"] },
    { title: "Schedule tumor board presentation", description: "Book the multidisciplinary tumor board slot and circulate the case list.", assignee: "rivera", creator: "nguyen", status: "DONE", priority: "MEDIUM", due: 3, created: [9, "17:45"], completed: [4, "14:18"] },
    { title: "Nutrition assessment for weight loss", description: "7 kg unintentional weight loss. Dietitian assessment and pancreatic enzyme replacement review.", assignee: "adams", creator: "nguyen", status: "TODO", priority: "MEDIUM", due: 3, created: [10, "17:22"] },
    { title: "Prepare tumor board brief", description: "Assemble imaging, pathology, labs and open questions for the tumor board presentation.", assignee: "nguyen", creator: "rivera", status: "TODO", priority: "HIGH", due: -1, created: [4, "14:25"] },
    { title: "Review CT abdomen for post-ERCP complication", description: "CT ordered overnight for falling hemoglobin and increased pain.", assignee: "lee", creator: "nguyen", status: "TODO", priority: "URGENT", due: 0, created: [1, "06:15"] },
    { title: "Repeat CBC at 12:00; notify if Hb < 8.0 g/dL", description: "Per night shift plan. Also notify for hemodynamic instability.", assignee: "adams", creator: "adams", status: "TODO", priority: "HIGH", due: 0, created: [1, "06:58"] },
  ];
  for (const task of tasks) {
    const created = await prisma.task.create({
      data: {
        caseRoomId,
        title: task.title,
        description: task.description,
        assignedToId: u(task.assignee).id,
        createdById: u(task.creator).id,
        status: task.status,
        priority: task.priority,
        dueDate: day(task.due),
        createdAt: at(...task.created),
        completedAt: task.completed ? at(...task.completed) : null,
      },
    });
    await audit(ctx, { caseRoomId, userId: u(task.creator).id, action: "task.created", resourceType: "Task", resourceId: created.id, metadata: { title: task.title, assignee: u(task.assignee).name }, createdAt: at(...task.created) });
    if (task.completed) {
      await audit(ctx, { caseRoomId, userId: u(task.assignee).id, action: "task.completed", resourceType: "Task", resourceId: created.id, metadata: { title: task.title }, createdAt: at(...task.completed) });
    }
  }

  // ── Previous handoff (approved) ──────────────────────────────────────────
  const handoff: SectionsContent = {
    kind: "sections",
    sections: [
      { key: "currentCondition", title: "Current condition", body: "Stable after ERCP with fully covered metal biliary stent. Afebrile, tolerating clear liquids. [1]", sources: [docRef(d("ercp"), "Successful sphincterotomy and fully covered metal stent placement.")] },
      { key: "changesSincePrevious", title: "Changes since previous shift", body: "- Hemoglobin 10.4 g/dL (12.8 g/dL on admission) [1]\n- Bilirubin improving: 2.1 mg/dL [1]\n- Enoxaparin prophylaxis resumed", sources: [docRef(d("labs2"), "Hemoglobin decreased from 12.8 g/dL on admission.")] },
      { key: "pending", title: "Pending", body: "- Blood culture identification and susceptibilities [1]", sources: [docRef(d("labs2"), "Identification and susceptibilities pending.")] },
      { key: "risks", title: "Risks", body: "- Bleeding: post-sphincterotomy oozing at ERCP, hemoglobin trending down [1]\n- Infection: gram-negative bacteremia on piperacillin-tazobactam [2]", sources: [docRef(d("ercp"), "Mild post-sphincterotomy bleeding, controlled endoscopically."), docRef(d("labs2"), "Gram-negative rods in 1 of 2 bottles.")] },
      { key: "nextActions", title: "Next actions", body: "- Repeat CBC in the morning\n- Advance diet as tolerated\n- Notify physician for fever or hemodynamic change", sources: [] },
    ],
    limitations: "Generated from the ERCP note and inpatient labs; edited by nursing before approval.",
  };
  const handoffBrief = await prisma.caseBrief.create({
    data: {
      caseRoomId,
      type: "HANDOFF",
      status: "APPROVED",
      title: `Handoff: day to night shift, ${fmt(day(2))}`,
      content: json(handoff),
      generatedByAI: true,
      aiProvider: "demo-seed",
      aiModel: "seed",
      requestedById: u("adams").id,
      editedById: u("adams").id,
      editedAt: at(2, "18:52"),
      approvedById: u("adams").id,
      approvedAt: at(2, "19:05"),
      createdAt: at(2, "18:40"),
    },
  });
  await audit(ctx, { caseRoomId, userId: u("adams").id, actorType: "AI", action: "handoff.generated", resourceType: "CaseBrief", resourceId: handoffBrief.id, metadata: { title: handoffBrief.title }, createdAt: at(2, "18:40") });
  await audit(ctx, { caseRoomId, userId: u("adams").id, action: "brief.edited", resourceType: "CaseBrief", resourceId: handoffBrief.id, metadata: { title: handoffBrief.title, briefType: "HANDOFF" }, createdAt: at(2, "18:52") });
  await audit(ctx, { caseRoomId, userId: u("adams").id, action: "brief.approved", resourceType: "CaseBrief", resourceId: handoffBrief.id, metadata: { title: handoffBrief.title, briefType: "HANDOFF" }, createdAt: at(2, "19:05") });

  // ── AI case summary (draft) ──────────────────────────────────────────────
  const summary: CaseSummaryContent = {
    kind: "case_summary",
    headline: "56-year-old male with pancreatic ductal adenocarcinoma of the head.",
    currentStatus:
      "Locally advanced vs borderline resectable disease without distant metastases. Currently admitted with acute cholangitis after metal biliary stent placement; hemoglobin falling (9.6 g/dL) with increased abdominal pain, CT abdomen pending.",
    currentDiagnosis:
      "Moderately differentiated pancreatic ductal adenocarcinoma (EUS-FNB) with SMAD4 loss. CT: 3.4 cm pancreatic head mass with >180° SMV-portal vein contact and 90-180° SMA contact; no hepatic or peritoneal metastases.",
    currentTreatment:
      `IV piperacillin-tazobactam for cholangitis with gram-negative bacteremia; enoxaparin prophylaxis on hold. Neoadjuvant chemotherapy proposed (Decision #${decision.number}, under review), to start once biliary drainage is established.`,
    keyFindings: [
      { text: "Pathology confirms moderately differentiated pancreatic ductal adenocarcinoma with SMAD4 loss.", sources: [docRef(d("path"), "Invasive adenocarcinoma, moderately differentiated, consistent with pancreatic ductal adenocarcinoma.")] },
      { text: "CT shows vascular involvement: >180° SMV-portal vein contact with narrowing and 90-180° SMA contact; no metastases.", sources: [docRef(d("ct"), "Vascular involvement: greater than 180 degrees SMV-portal vein contact with short-segment narrowing, and 90-180 degrees SMA contact.")] },
      { text: "CA 19-9 elevated at 1,240 U/mL in the setting of biliary obstruction.", sources: [docRef(d("labs1"), "CA 19-9 is markedly elevated.")] },
      { text: "Surgical oncology: not a candidate for upfront resection; re-evaluate after neoadjuvant therapy.", sources: [docRef(d("surg"), "Not a candidate for upfront resection because of the SMA contact and the high risk of a margin-positive resection.")] },
      { text: "Admitted with acute cholangitis; fully covered metal biliary stent placed at ERCP; blood cultures growing gram-negative rods.", sources: [docRef(d("hp"), "Acute cholangitis secondary to malignant biliary obstruction from pancreatic head adenocarcinoma."), docRef(d("ercp")), docRef(d("labs2"), "Gram-negative rods in 1 of 2 bottles.")] },
    ],
    latestResults: [
      { label: "Hemoglobin", value: "9.6 g/dL (12.8 → 10.4 → 9.6)", date: day(1).toISOString().slice(0, 10), flag: "abnormal", sources: [docRef(d("nursing"), "Morning hemoglobin 9.6 g/dL (10.4 g/dL yesterday, 12.8 g/dL on admission).")] },
      { label: "Blood cultures", value: "Gram-negative rods in 1 of 2 bottles; ID pending", date: day(2).toISOString().slice(0, 10), flag: "abnormal", sources: [docRef(d("labs2"), "Gram-negative rods in 1 of 2 bottles.")] },
      { label: "Total bilirubin", value: "2.1 mg/dL (6.2 on admission)", date: day(2).toISOString().slice(0, 10), flag: "abnormal", sources: [docRef(d("labs2"))] },
      { label: "White blood cells", value: "11.8 x10^3/uL", date: day(2).toISOString().slice(0, 10), flag: "abnormal", sources: [docRef(d("labs2"))] },
      { label: "CA 19-9", value: "1,240 U/mL", date: day(16).toISOString().slice(0, 10), flag: "abnormal", sources: [docRef(d("labs1"))] },
    ],
    outstandingQuestions: [
      "Surgical resectability: borderline resectable vs locally advanced?",
      "Neoadjuvant treatment selection and timing once cholangitis resolves.",
      "Cause of falling hemoglobin: post-sphincterotomy bleeding vs other complication (CT pending).",
    ],
    missingInformation: [
      { item: "Molecular (NGS) testing results", reason: "Recommended by pathology; the order is still outstanding.", priority: "high" },
      { item: "CT abdomen result (post-ERCP)", reason: "Ordered overnight for falling hemoglobin and increased pain.", priority: "high" },
      { item: "Germline genetic testing", reason: "Maternal history of breast cancer at 49; counseling referral in progress.", priority: "medium" },
      { item: "Nutrition assessment", reason: "7 kg weight loss documented; assessment not yet completed.", priority: "medium" },
    ],
    limitations: "Generated from 10 documents. Blood culture identification and CT results are pending and not reflected.",
  };
  const summaryBrief = await prisma.caseBrief.create({
    data: {
      caseRoomId,
      type: "CASE_SUMMARY",
      status: "DRAFT",
      title: "AI case summary",
      content: json(summary),
      generatedByAI: true,
      aiProvider: "demo-seed",
      aiModel: "seed",
      requestedById: u("nguyen").id,
      createdAt: at(1, "06:30"),
    },
  });
  await audit(ctx, { caseRoomId, userId: u("nguyen").id, actorType: "AI", action: "ai.summary_generated", resourceType: "CaseBrief", resourceId: summaryBrief.id, metadata: { documents: 10 }, createdAt: at(1, "06:30") });

  // ── Shared memory ────────────────────────────────────────────────────────
  await buildSeedMemory(ctx, caseRoomId, `${summary.headline} ${summary.currentStatus}`);
  await prisma.caseRoom.update({ where: { id: caseRoomId }, data: { updatedAt: at(1, "06:30") } });

  return { caseRoomId };
}
