import type { CaseContext } from "@ccr/types";

/** Small synthetic case used by unit tests. Not a real patient. */
export function syntheticCase(): CaseContext {
  return {
    patient: {
      id: "p1",
      displayName: "Test Patient",
      firstName: "Test",
      lastName: "Patient",
      age: 60,
      sex: "MALE",
      dateOfBirth: "1966-01-01",
      mrn: "SYN-000001",
      primaryDiagnosis: "Pancreatic adenocarcinoma",
      status: "ACTIVE",
    },
    caseRoom: { id: "c1", title: "Test case", specialty: "ONCOLOGY", status: "REVIEWING" },
    documents: [
      {
        id: "doc-ct",
        type: "IMAGING_REPORT",
        title: "CT abdomen",
        date: "2026-09-01",
        uploadedBy: "Dr. Radiologist",
        text: `FINDINGS:
Pancreas: 3.0 cm hypoenhancing mass in the pancreatic head.

IMPRESSION:
1. 3.0 cm pancreatic head mass, suspicious for adenocarcinoma.
2. Vascular involvement: greater than 180 degrees SMV contact.
3. No hepatic metastases.`,
      },
      {
        id: "doc-labs",
        type: "LAB_RESULT",
        title: "Labs",
        date: "2026-09-03",
        uploadedBy: "Dr. Oncologist",
        text: `RESULTS:
TEST                      RESULT      UNITS      REFERENCE      FLAG
CA 19-9                   980         U/mL       0-37           H
Hemoglobin                12.9        g/dL       13.5-17.5      L
FEV1                      1.98        L          >2.40          L
Platelets                 250         x10^3/uL   150-400

INTERPRETATION:
CA 19-9 is elevated.`,
      },
      {
        id: "doc-path",
        type: "PATHOLOGY_REPORT",
        title: "Pathology",
        date: "2026-09-05",
        uploadedBy: "Dr. Pathologist",
        text: `FINAL DIAGNOSIS:
Pancreas, head mass, biopsy: Invasive adenocarcinoma, moderately differentiated, consistent with pancreatic ductal adenocarcinoma.

COMMENT:
Tissue quantity is adequate for molecular testing.`,
      },
      {
        id: "doc-nursing",
        type: "CLINICAL_NOTE",
        title: "Nursing shift note",
        date: "2026-09-07",
        uploadedBy: "Nurse",
        text: `SITUATION:
Patient reports increased abdominal pain overnight.

ASSESSMENT:
Hemodynamically stable. Morning hemoglobin 10.1 g/dL.

MEDICATIONS: Oxycodone 5 mg every 6 hours as needed.
ALLERGIES: No known drug allergies.

PENDING:
- CT abdomen result.

RISKS:
- Bleeding: falling hemoglobin.

RECOMMENDATIONS FOR NEXT SHIFT:
- Repeat CBC at noon.`,
      },
    ],
    timeline: [
      { id: "t1", date: "2026-09-01", eventType: "IMAGING", title: "CT shows mass", description: "3.0 cm mass", sourceDocumentId: "doc-ct", createdByAI: true },
    ],
    decisions: [
      {
        id: "dec1",
        number: 1,
        title: "Neoadjuvant chemotherapy before surgery",
        description: "Start neoadjuvant chemotherapy and restage.",
        rationale: "Vascular involvement makes upfront surgery unlikely to achieve negative margins.",
        status: "UNDER_REVIEW",
        proposedBy: "Dr. Oncologist",
        createdAt: "2026-09-06T10:00:00.000Z",
        finalizedAt: null,
        sourceDocumentIds: ["doc-ct", "doc-path"],
        approvals: [{ reviewer: "Dr. Surgeon", specialty: "Surgery", status: "PENDING", comment: null }],
      },
    ],
    tasks: [
      { id: "task1", title: "Order molecular testing", description: null, status: "TODO", priority: "HIGH", assignee: "Dr. Oncologist", dueDate: "2026-09-08" },
    ],
    messages: [
      { id: "m1", type: "USER", author: "Dr. Oncologist", authorSpecialty: "Oncology", content: "Tumor board is scheduled for Oct 2 at 07:30.", createdAt: "2026-09-06T09:00:00.000Z" },
    ],
    memory: null,
    team: [
      { id: "u1", name: "Dr. Oncologist", role: "DOCTOR", specialty: "Medical Oncology", handle: "DrOnc" },
      { id: "u2", name: "Dr. Surgeon", role: "SPECIALIST", specialty: "Surgical Oncology", handle: "DrSurg" },
      { id: "u3", name: "Nurse", role: "NURSE", specialty: "Oncology Nursing", handle: "Nurse" },
    ],
    requester: { id: "u1", name: "Dr. Oncologist", role: "DOCTOR", specialty: "Medical Oncology" },
    now: "2026-09-08T08:00:00.000Z",
  };
}
