import type { CaseSpec } from "../case-builder";
import { SYNTHETIC_HEADER, day, fmt } from "../helpers";

/** Four additional synthetic cases covering different workflow states. */

export const mariaGonzalez: CaseSpec = {
  patient: { mrn: "SYN-100418", firstName: "Maria", lastName: "Gonzalez", age: 48, birthdayMonthsAgo: 3, sex: "FEMALE", primaryDiagnosis: "Breast cancer, invasive ductal carcinoma (HER2-positive)", status: "IN_TREATMENT" },
  room: { title: "Left breast IDC: neoadjuvant planning", specialty: "ONCOLOGY", status: "REVIEWING", createdBy: "nguyen", created: [29, "09:10"] },
  members: [["lee", 29, "09:11"], ["patel", 29, "09:11"], ["smith", 20, "10:00"], ["rivera", 29, "09:12"], ["adams", 15, "12:00"]],
  documents: [
    {
      key: "mammo", type: "IMAGING_REPORT", title: "Diagnostic mammogram and breast ultrasound", days: 30, time: "15:30", uploadedBy: "lee",
      text: `${SYNTHETIC_HEADER}

BREAST IMAGING REPORT
EXAM: Diagnostic bilateral mammogram and targeted left breast ultrasound
DATE OF EXAM: ${fmt(day(30))}
PATIENT: Maria Gonzalez | MRN: SYN-100418

CLINICAL HISTORY: 48-year-old woman with a palpable lump in the left breast for 6 weeks.

FINDINGS:
Mammogram: Irregular high-density mass with spiculated margins at the 2 o'clock position of the left breast, 6 cm from the nipple, with associated pleomorphic calcifications. No suspicious findings in the right breast.
Ultrasound: Irregular hypoechoic mass measuring 2.8 x 2.1 x 2.4 cm at 2 o'clock with posterior acoustic shadowing. One morphologically abnormal left axillary lymph node with cortical thickening to 5 mm.

IMPRESSION:
1. 2.8 cm irregular mass in the left breast at 2 o'clock, highly suggestive of malignancy (BI-RADS 5).
2. Abnormal left axillary lymph node.
3. Right breast: no evidence of malignancy (BI-RADS 1).

RECOMMENDATION: Ultrasound-guided core biopsy of the left breast mass and fine-needle aspiration of the axillary node.`,
    },
    {
      key: "path", type: "PATHOLOGY_REPORT", title: "Core biopsy pathology: left breast and axillary node", days: 26, time: "16:10", uploadedBy: "patel",
      text: `${SYNTHETIC_HEADER}

SURGICAL PATHOLOGY REPORT
ACCESSION: SYN-S26-03902
SPECIMEN: A. Left breast, 2 o'clock, ultrasound-guided core biopsy. B. Left axillary lymph node, fine-needle aspiration.
DATE REPORTED: ${fmt(day(26))}
PATHOLOGIST: Dr. Priya Patel

FINAL DIAGNOSIS:
A. Left breast, 2 o'clock, core biopsy: Invasive ductal carcinoma, Nottingham grade 2 (tubules 3, nuclei 2, mitoses 1).
B. Left axillary lymph node, FNA: Positive for metastatic carcinoma, consistent with breast primary.

BIOMARKERS:
Estrogen receptor: positive (95%, strong). Progesterone receptor: positive (60%, moderate). HER2 by immunohistochemistry: 3+ (positive). Ki-67: 30%.

COMMENT:
The tumor is hormone receptor-positive and HER2-positive. Biomarker results are suitable for treatment planning.`,
    },
    {
      key: "mri", type: "IMAGING_REPORT", title: "Breast MRI with and without contrast", days: 20, time: "14:00", uploadedBy: "lee",
      text: `${SYNTHETIC_HEADER}

RADIOLOGY REPORT
EXAM: Bilateral breast MRI with and without contrast
DATE OF EXAM: ${fmt(day(20))}
PATIENT: Maria Gonzalez | MRN: SYN-100418

FINDINGS:
Irregular enhancing mass in the upper outer quadrant of the left breast at 2 o'clock with biopsy clip artifact, measuring 3.1 x 2.4 x 2.6 cm. No additional suspicious enhancement in either breast. Two enlarged left axillary level I lymph nodes.

IMPRESSION:
1. Known biopsy-proven malignancy in the left breast at 2 o'clock measuring 3.1 cm in greatest dimension, with no additional suspicious lesions in either breast.
2. Two enlarged left axillary level I lymph nodes, the largest 1.6 cm.
3. No chest wall or skin involvement.`,
    },
    {
      key: "onc", type: "CLINICAL_NOTE", title: "Medical oncology consultation", days: 15, time: "17:00", uploadedBy: "nguyen",
      text: `${SYNTHETIC_HEADER}

MEDICAL ONCOLOGY CONSULTATION
DATE OF SERVICE: ${fmt(day(15))}
PHYSICIAN: Dr. Minh Nguyen, Medical Oncology

HISTORY OF PRESENT ILLNESS:
Ms. Gonzalez is a 48-year-old premenopausal woman who noticed a left breast lump 6 weeks ago. Imaging and biopsy show a 3.1 cm grade 2 invasive ductal carcinoma, ER-positive, PR-positive, HER2-positive (3+), with biopsy-proven axillary nodal involvement.

PAST MEDICAL HISTORY: Hypothyroidism.
MEDICATIONS: Levothyroxine 75 mcg daily.
ALLERGIES: Penicillin (rash).
FAMILY HISTORY: Maternal aunt with ovarian cancer at 52.
PERFORMANCE STATUS: ECOG 0.

ASSESSMENT AND PLAN:
Clinical stage cT2 cN1 M0 HER2-positive, hormone receptor-positive left breast cancer.
1. Recommend neoadjuvant chemotherapy with HER2-directed therapy (TCHP: docetaxel, carboplatin, trastuzumab, pertuzumab) for 6 cycles, followed by surgery.
2. Baseline echocardiogram before trastuzumab.
3. Genetic counseling and germline testing given family history of ovarian cancer.
4. Fertility preservation discussion before chemotherapy.
5. Port placement.

QUESTIONS FOR TUMOR BOARD:
1. Is neoadjuvant TCHP the preferred approach for cT2 cN1 HER2-positive disease?
2. Is the patient a candidate for breast-conserving surgery after neoadjuvant therapy?
3. Should the biopsied axillary node be clipped before starting treatment?`,
    },
    {
      key: "echo", type: "IMAGING_REPORT", title: "Transthoracic echocardiogram", days: 6, time: "11:20", uploadedBy: "rivera",
      text: `${SYNTHETIC_HEADER}

ECHOCARDIOGRAM REPORT
DATE OF STUDY: ${fmt(day(6))}
PATIENT: Maria Gonzalez | MRN: SYN-100418
INDICATION: Baseline assessment before HER2-directed therapy.

IMPRESSION:
1. Normal left ventricular size and systolic function; LVEF 62% by biplane method.
2. No significant valvular disease.
3. Normal right ventricular function.`,
    },
  ],
  messages: [
    { author: "nguyen", at: [29, "09:15"], content: "Opening this case for a new HER2-positive breast cancer referral. @DrPatel pathology is pending; @DrLee MRI requested to define extent.", mentions: ["patel", "lee"] },
    { author: "patel", at: [26, "16:20"], content: "Pathology is in: IDC grade 2, ER 95%, PR 60%, HER2 3+, Ki-67 30%. The axillary FNA is positive." },
    { askAI: "summarize the pathology findings.", author: "nguyen", at: [26, "17:02"] },
    { author: "smith", at: [12, "15:40"], content: "Agree with a neoadjuvant approach. She may be a candidate for breast conservation depending on response. Please clip the node before cycle 1." },
    { author: "rivera", at: [6, "12:05"], content: "Echo done today, LVEF 62%. Port placement is booked and fertility consult completed." },
  ],
  decision: {
    title: "Neoadjuvant TCHP x6 followed by surgery",
    description: "Neoadjuvant docetaxel, carboplatin, trastuzumab and pertuzumab for 6 cycles, followed by surgery (breast conservation if response allows) with axillary management based on clipped-node assessment.",
    rationale: "cT2 cN1 HER2-positive, hormone receptor-positive invasive ductal carcinoma. Neoadjuvant HER2-directed therapy allows response assessment and may enable breast conservation. ECOG 0; baseline cardiac function to be confirmed before trastuzumab.",
    status: "APPROVED",
    createdBy: "nguyen",
    created: [12, "09:00"],
    sources: ["path", "mri", "onc"],
    approvals: [
      { reviewer: "smith", status: "APPROVED", comment: "Agree. Clip the axillary node before starting treatment.", responded: [12, "15:35"] },
      { reviewer: "lee", status: "APPROVED", comment: "Imaging supports cT2 cN1 staging.", responded: [11, "10:10"] },
      { reviewer: "patel", status: "APPROVED", comment: "Biomarkers confirmed.", responded: [10, "14:45"] },
    ],
    finalized: [10, "14:45"],
  },
  tasks: [
    { title: "Baseline echocardiogram before trastuzumab", assignee: "rivera", creator: "nguyen", status: "DONE", priority: "HIGH", due: 5, created: [15, "17:10"], completed: [6, "11:25"] },
    { title: "Fertility preservation consult", assignee: "adams", creator: "nguyen", status: "DONE", priority: "MEDIUM", due: 8, created: [15, "17:12"], completed: [8, "16:00"] },
    { title: "Arrange port placement", assignee: "rivera", creator: "nguyen", status: "IN_PROGRESS", priority: "MEDIUM", due: -2, created: [10, "15:00"], fromDecision: true, createdByAI: true },
    { title: "Clip biopsied axillary node before cycle 1", assignee: "lee", creator: "smith", status: "TODO", priority: "HIGH", due: -1, created: [12, "15:40"] },
    { title: "Refer for germline genetic counseling", assignee: "rivera", creator: "nguyen", status: "TODO", priority: "MEDIUM", due: -7, created: [10, "15:01"], fromDecision: true, createdByAI: true },
  ],
  summary: { status: "APPROVED", requestedBy: "nguyen", at: [5, "08:30"], approvedBy: "nguyen", approvedAt: [5, "08:45"] },
};

export const robertKim: CaseSpec = {
  patient: { mrn: "SYN-100562", firstName: "Robert", lastName: "Kim", age: 67, birthdayMonthsAgo: 8, sex: "MALE", primaryDiagnosis: "Non-small cell lung cancer (adenocarcinoma), right upper lobe", status: "ACTIVE" },
  room: { title: "RUL lung adenocarcinoma: stage III treatment planning", specialty: "ONCOLOGY", status: "DECISION_PENDING", createdBy: "nguyen", created: [34, "10:00"] },
  members: [["lee", 34, "10:01"], ["patel", 22, "09:00"], ["obrien", 20, "09:00"], ["smith", 20, "09:01"], ["rivera", 34, "10:02"]],
  documents: [
    {
      key: "ct", type: "IMAGING_REPORT", title: "CT chest with contrast", days: 35, time: "13:00", uploadedBy: "lee",
      text: `${SYNTHETIC_HEADER}

RADIOLOGY REPORT
EXAM: CT chest with IV contrast
DATE OF EXAM: ${fmt(day(35))}
PATIENT: Robert Kim | MRN: SYN-100562
CLINICAL HISTORY: 67-year-old former smoker with persistent cough and a lung nodule on chest radiograph.

FINDINGS:
A 2.8 x 2.3 cm spiculated mass in the posterior segment of the right upper lobe. Enlarged right lower paratracheal (station 4R) lymph node measuring 1.4 cm in short axis. Moderate centrilobular emphysema. No pleural effusion.

IMPRESSION:
1. 2.8 cm spiculated mass in the right upper lobe, highly suspicious for primary lung malignancy.
2. Enlarged right lower paratracheal (station 4R) lymph node measuring 1.4 cm in short axis.
3. No pleural effusion. No suspicious osseous lesions.`,
    },
    {
      key: "pet", type: "IMAGING_REPORT", title: "PET-CT (FDG) staging", days: 28, time: "15:20", uploadedBy: "lee",
      text: `${SYNTHETIC_HEADER}

NUCLEAR MEDICINE REPORT
EXAM: FDG PET-CT, skull base to mid-thigh
DATE OF EXAM: ${fmt(day(28))}
PATIENT: Robert Kim | MRN: SYN-100562

IMPRESSION:
1. Hypermetabolic right upper lobe mass (SUVmax 9.8) consistent with primary malignancy.
2. FDG-avid right lower paratracheal (4R) lymph node (SUVmax 5.1), suspicious for nodal metastasis.
3. No FDG-avid distant metastatic disease.`,
    },
    {
      key: "path", type: "PATHOLOGY_REPORT", title: "EBUS-TBNA and bronchoscopic biopsy pathology", days: 21, time: "16:45", uploadedBy: "patel",
      text: `${SYNTHETIC_HEADER}

SURGICAL PATHOLOGY REPORT
ACCESSION: SYN-S26-04106
SPECIMEN: A. Lymph node, station 4R, EBUS-TBNA. B. Right upper lobe mass, transbronchial biopsy.
DATE REPORTED: ${fmt(day(21))}
PATHOLOGIST: Dr. Priya Patel

FINAL DIAGNOSIS:
A. Lymph node, station 4R, EBUS-TBNA: Positive for metastatic adenocarcinoma, consistent with lung primary.
B. Right upper lobe mass, transbronchial biopsy: Invasive adenocarcinoma, acinar predominant.

IMMUNOHISTOCHEMISTRY:
TTF-1 positive. Napsin A positive. PD-L1 (22C3) tumor proportion score 60%.

COMMENT:
Molecular testing (EGFR, ALK, ROS1, KRAS, BRAF, MET, RET, NTRK) has been sent to the reference laboratory; results pending.`,
    },
    {
      key: "pft", type: "LAB_RESULT", title: "Pulmonary function tests", days: 18, time: "10:30", uploadedBy: "rivera",
      text: `${SYNTHETIC_HEADER}

PULMONARY FUNCTION TEST REPORT
DATE: ${fmt(day(18))}
PATIENT: Robert Kim | MRN: SYN-100562

RESULTS:
TEST                      RESULT      UNITS      REFERENCE      FLAG
FEV1                      1.98        L          >2.40          L
FEV1 percent predicted    72          %          >80            L
FVC                       2.95        L          >3.10          L
DLCO percent predicted    65          %          >75            L

INTERPRETATION:
Mild obstructive ventilatory defect with moderately reduced diffusion capacity. Predicted postoperative FEV1 and DLCO after right upper lobectomy are estimated above 40%, supporting operability.`,
    },
    {
      key: "mdt", type: "CLINICAL_NOTE", title: "Thoracic oncology consultation", days: 10, time: "17:30", uploadedBy: "nguyen",
      text: `${SYNTHETIC_HEADER}

THORACIC ONCOLOGY CONSULTATION
DATE OF SERVICE: ${fmt(day(10))}
PHYSICIAN: Dr. Minh Nguyen, Medical Oncology

HISTORY OF PRESENT ILLNESS:
Mr. Kim is a 67-year-old former smoker (40 pack-years) with a 2.8 cm right upper lobe adenocarcinoma and biopsy-proven single-station N2 disease (4R). PET-CT shows no distant metastases. PD-L1 tumor proportion score is 60%. Molecular results are pending.

PAST MEDICAL HISTORY: COPD. Coronary artery disease with stent in 2019. Type 2 diabetes.
MEDICATIONS: Aspirin 81 mg daily. Metformin 1000 mg twice daily. Tiotropium inhaler daily. Atorvastatin 40 mg daily.
ALLERGIES: No known drug allergies.
PERFORMANCE STATUS: ECOG 1.

ASSESSMENT AND PLAN:
Clinical stage IIIA (cT1c N2 M0) non-small cell lung cancer, adenocarcinoma, PD-L1 60%.
1. Options discussed: neoadjuvant chemoimmunotherapy followed by right upper lobectomy, versus definitive concurrent chemoradiation followed by consolidation immunotherapy.
2. Surgical candidacy supported by pulmonary function tests.
3. EGFR and ALK status must be known before immunotherapy is started.
4. Brain MRI for staging to be scheduled.

QUESTIONS FOR TUMOR BOARD:
1. Is single-station N2 disease best managed with neoadjuvant chemoimmunotherapy and surgery, or with definitive chemoradiation?
2. Should treatment start be deferred until EGFR/ALK results are available?`,
    },
  ],
  messages: [
    { author: "nguyen", at: [34, "10:05"], content: "New RUL mass with a suspicious 4R node. @DrLee PET-CT is ordered; can you confirm staging once it's back?", mentions: ["lee"] },
    { author: "lee", at: [28, "16:00"], content: "PET-CT: RUL primary SUV 9.8, 4R node SUV 5.1, no distant disease. EBUS of 4R would confirm N2." },
    { askAI: "What did the PET-CT show?", author: "obrien", at: [20, "09:30"] },
    { author: "smith", at: [9, "11:15"], content: "PFTs support lobectomy. Single-station N2 is reasonable for a neoadjuvant approach if he responds." },
    { author: "obrien", at: [4, "16:30"], content: "I requested changes on the decision: we should not start immunotherapy before EGFR/ALK are back. Definitive chemoradiation remains an option too." },
  ],
  decision: {
    title: "Neoadjuvant chemoimmunotherapy followed by right upper lobectomy",
    description: "Three cycles of platinum-doublet chemotherapy with immunotherapy, restaging, then right upper lobectomy with mediastinal lymph node dissection if no progression.",
    rationale: "Single-station N2 (4R) stage IIIA adenocarcinoma, PD-L1 60%, ECOG 1, adequate pulmonary reserve on PFTs. Surgical oncology considers him operable.",
    status: "UNDER_REVIEW",
    createdBy: "nguyen",
    created: [6, "18:00"],
    sources: ["pet", "path", "pft", "mdt"],
    approvals: [
      { reviewer: "smith", status: "APPROVED", comment: "Operable based on PFTs; single-station N2 is reasonable for a neoadjuvant approach.", responded: [5, "08:40"] },
      { reviewer: "obrien", status: "NEEDS_CHANGES", comment: "Please hold until EGFR/ALK results return. If EGFR or ALK is positive, the immunotherapy-based plan should be revised.", responded: [4, "16:20"] },
      { reviewer: "lee", status: "PENDING" },
    ],
  },
  tasks: [
    { title: "Follow up EGFR/ALK molecular results", description: "Reference lab send-out; results needed before immunotherapy.", assignee: "patel", creator: "nguyen", status: "IN_PROGRESS", priority: "HIGH", due: -2, created: [21, "17:00"] },
    { title: "Schedule brain MRI for staging", assignee: "rivera", creator: "nguyen", status: "TODO", priority: "HIGH", due: 1, created: [10, "17:40"] },
    { title: "Cardiology pre-operative risk assessment (CAD with stent)", assignee: "rivera", creator: "smith", status: "TODO", priority: "MEDIUM", due: -5, created: [9, "11:20"] },
  ],
  summary: { status: "DRAFT", requestedBy: "nguyen", at: [4, "18:00"] },
};

export const lindaThompson: CaseSpec = {
  patient: { mrn: "SYN-100377", firstName: "Linda", lastName: "Thompson", age: 72, birthdayMonthsAgo: 1, sex: "FEMALE", primaryDiagnosis: "Metastatic colorectal adenocarcinoma (liver metastases)", status: "IN_TREATMENT" },
  room: { title: "Sigmoid adenocarcinoma with liver metastases: first-line plan", specialty: "ONCOLOGY", status: "CLOSED", createdBy: "nguyen", created: [61, "09:00"] },
  members: [["lee", 61, "09:01"], ["patel", 61, "09:01"], ["smith", 50, "10:00"], ["rivera", 61, "09:02"], ["adams", 44, "12:00"]],
  documents: [
    {
      key: "ct", type: "IMAGING_REPORT", title: "CT chest, abdomen and pelvis with contrast", days: 60, time: "14:00", uploadedBy: "lee",
      text: `${SYNTHETIC_HEADER}

RADIOLOGY REPORT
EXAM: CT chest, abdomen and pelvis with IV contrast
DATE OF EXAM: ${fmt(day(60))}
PATIENT: Linda Thompson | MRN: SYN-100377
CLINICAL HISTORY: 72-year-old woman with rectal bleeding and iron-deficiency anemia.

IMPRESSION:
1. Circumferential wall thickening of the sigmoid colon over 5 cm, consistent with the known primary malignancy.
2. Three hepatic metastases in segments VI, VII and VIII, the largest 3.2 cm in segment VII.
3. No pulmonary metastases.`,
    },
    {
      key: "path", type: "PATHOLOGY_REPORT", title: "Colonoscopy biopsy pathology: sigmoid mass", days: 55, time: "15:30", uploadedBy: "patel",
      text: `${SYNTHETIC_HEADER}

SURGICAL PATHOLOGY REPORT
ACCESSION: SYN-S26-02988
SPECIMEN: Sigmoid colon, mass at 25 cm, endoscopic biopsy
DATE REPORTED: ${fmt(day(55))}
PATHOLOGIST: Dr. Priya Patel

FINAL DIAGNOSIS:
Sigmoid colon, mass at 25 cm, endoscopic biopsy: Invasive adenocarcinoma, moderately differentiated.

IMMUNOHISTOCHEMISTRY:
Mismatch repair proteins MLH1, PMS2, MSH2 and MSH6 show intact expression (proficient mismatch repair).`,
    },
    {
      key: "ngs", type: "LAB_RESULT", title: "Tumor molecular profile (NGS)", days: 48, time: "11:00", uploadedBy: "patel",
      text: `${SYNTHETIC_HEADER}

MOLECULAR PATHOLOGY REPORT
DATE REPORTED: ${fmt(day(48))}
PATIENT: Linda Thompson | MRN: SYN-100377
SPECIMEN: Sigmoid colon adenocarcinoma, biopsy

RESULTS:
KRAS: G12D mutation detected.
NRAS: wild-type (no mutation detected).
BRAF V600E: not detected.
Microsatellite status: stable (MSS).
HER2 amplification: not detected.

INTERPRETATION:
RAS-mutant, BRAF wild-type, microsatellite-stable colorectal adenocarcinoma. Anti-EGFR therapy is not indicated given the KRAS mutation.`,
    },
    {
      key: "labs", type: "LAB_RESULT", title: "Baseline laboratory panel", days: 47, time: "09:30", uploadedBy: "adams",
      text: `${SYNTHETIC_HEADER}

LABORATORY REPORT
COLLECTED: ${fmt(day(47))} 07:50
PATIENT: Linda Thompson | MRN: SYN-100377

RESULTS:
TEST                      RESULT      UNITS      REFERENCE      FLAG
CEA                       48.0        ng/mL      0.0-3.0        H
Hemoglobin                10.2        g/dL       12.0-15.5      L
Platelets                 312         x10^3/uL   150-400
Total bilirubin           0.7         mg/dL      0.2-1.2
Alkaline phosphatase      168         U/L        40-129         H
Creatinine                0.8         mg/dL      0.6-1.1

INTERPRETATION:
CEA markedly elevated. Mild anemia consistent with known GI blood loss. Liver synthetic function preserved.`,
    },
    {
      key: "onc", type: "CLINICAL_NOTE", title: "Medical oncology consultation", days: 46, time: "16:40", uploadedBy: "nguyen",
      text: `${SYNTHETIC_HEADER}

MEDICAL ONCOLOGY CONSULTATION
DATE OF SERVICE: ${fmt(day(46))}
PHYSICIAN: Dr. Minh Nguyen, Medical Oncology

HISTORY OF PRESENT ILLNESS:
Ms. Thompson is a 72-year-old woman with rectal bleeding and anemia who was found to have a sigmoid adenocarcinoma with three liver metastases. CEA 48.0 ng/mL.

PAST MEDICAL HISTORY: Hypertension. Osteoarthritis.
MEDICATIONS: Amlodipine 5 mg daily. Ferrous sulfate 325 mg daily.
ALLERGIES: No known drug allergies.
PERFORMANCE STATUS: ECOG 1.

ASSESSMENT AND PLAN:
Stage IV (liver-only) KRAS G12D-mutant, microsatellite-stable sigmoid adenocarcinoma.
1. First-line FOLFOX plus bevacizumab.
2. Hepatobiliary surgery review of liver metastases for potential resectability after response.
3. Restaging CT after 4 cycles (approximately 8 weeks).
4. Patient counseled on goals of care; she wishes to pursue treatment with curative intent if possible.`,
    },
  ],
  messages: [
    { author: "nguyen", at: [60, "15:00"], content: "Liver-limited metastatic colorectal cancer. @DrPatel please send NGS with MMR once the biopsy is in.", mentions: ["patel"] },
    { author: "patel", at: [48, "11:10"], content: "NGS resulted: KRAS G12D, NRAS/BRAF wild-type, MSS. MMR proficient." },
    { askAI: "Summarize the molecular results.", author: "smith", at: [47, "08:15"] },
    { author: "smith", at: [45, "14:00"], content: "Liver disease is not resectable today; happy to re-review after 4 cycles." },
    { author: "rivera", at: [40, "10:00"], content: "Cycle 1 completed. Restaging CT is booked. Closing this case room now that the plan is final." },
  ],
  decision: {
    title: "First-line FOLFOX + bevacizumab; reassess liver resectability after restaging",
    description: "Start first-line FOLFOX with bevacizumab. Restage after 4 cycles and re-present to hepatobiliary surgery for potential liver metastasectomy.",
    rationale: "Liver-limited stage IV disease, KRAS G12D-mutant (anti-EGFR therapy not indicated), MSS, ECOG 1. The goal is conversion to resectability where possible.",
    status: "APPROVED",
    createdBy: "nguyen",
    created: [44, "18:00"],
    sources: ["ct", "ngs", "onc"],
    approvals: [
      { reviewer: "smith", status: "APPROVED", comment: "Agree; re-present after 4 cycles.", responded: [43, "09:00"] },
      { reviewer: "lee", status: "APPROVED", responded: [43, "12:30"] },
      { reviewer: "patel", status: "APPROVED", responded: [42, "10:00"] },
    ],
    finalized: [42, "10:00"],
  },
  tasks: [
    { title: "Chemotherapy teaching and consent", assignee: "adams", creator: "nguyen", status: "DONE", priority: "HIGH", due: 41, created: [42, "11:00"], completed: [41, "15:00"], fromDecision: true, createdByAI: true },
    { title: "Arrange port placement", assignee: "rivera", creator: "nguyen", status: "DONE", priority: "MEDIUM", due: 40, created: [42, "11:01"], completed: [41, "09:00"], fromDecision: true, createdByAI: true },
    { title: "Schedule restaging CT after 4 cycles", assignee: "rivera", creator: "nguyen", status: "DONE", priority: "MEDIUM", due: 38, created: [42, "11:02"], completed: [40, "10:00"], fromDecision: true, createdByAI: true },
  ],
  tumorBoard: { requestedBy: "nguyen", at: [45, "07:00"], approvedBy: "nguyen", approvedAt: [45, "07:20"] },
  summary: { status: "APPROVED", requestedBy: "nguyen", at: [40, "09:30"], approvedBy: "nguyen", approvedAt: [40, "09:40"] },
  closed: { by: "rivera", at: [40, "10:00"] },
};

export const samuelOkafor: CaseSpec = {
  patient: { mrn: "SYN-100689", firstName: "Samuel", lastName: "Okafor", age: 69, birthdayMonthsAgo: 6, sex: "MALE", primaryDiagnosis: "Acute decompensated heart failure with reduced ejection fraction", status: "ACTIVE" },
  room: { title: "ADHF admission: diuresis and therapy optimization", specialty: "CARDIOLOGY", status: "REVIEWING", createdBy: "brooks", created: [3, "07:30"] },
  members: [["adams", 3, "07:31"], ["rivera", 3, "07:32"]],
  documents: [
    {
      key: "admission", type: "CLINICAL_NOTE", title: "Emergency department note and admission", days: 3, time: "07:20", uploadedBy: "brooks",
      text: `${SYNTHETIC_HEADER}

EMERGENCY DEPARTMENT NOTE AND ADMISSION
DATE OF SERVICE: ${fmt(day(3))}
PHYSICIAN: Dr. Hannah Brooks, Cardiology

HISTORY OF PRESENT ILLNESS:
69-year-old man with ischemic cardiomyopathy presenting with 5 days of progressive dyspnea on exertion, orthopnea and 6 kg weight gain after running out of furosemide.

VITAL SIGNS: BP 148/92, HR 104, RR 24, SpO2 91% on room air.

PAST MEDICAL HISTORY: Ischemic cardiomyopathy. Prior myocardial infarction (2021). Chronic kidney disease stage 3a. Type 2 diabetes.
MEDICATIONS: Furosemide 40 mg daily (ran out 1 week ago). Metoprolol succinate 50 mg daily. Lisinopril 10 mg daily. Empagliflozin 10 mg daily.
ALLERGIES: No known drug allergies.

ASSESSMENT:
Acute decompensated heart failure with reduced ejection fraction, precipitated by diuretic non-adherence. Volume overloaded.

PLAN:
- IV furosemide 80 mg twice daily; strict intake and output; daily weights.
- Telemetry.
- Echocardiogram.
- Basic metabolic panel twice daily during diuresis.
- Hold lisinopril while creatinine is elevated.`,
    },
    {
      key: "labs", type: "LAB_RESULT", title: "Admission labs", days: 3, time: "07:25", uploadedBy: "adams",
      text: `${SYNTHETIC_HEADER}

LABORATORY REPORT
COLLECTED: ${fmt(day(3))} 03:10
PATIENT: Samuel Okafor | MRN: SYN-100689

RESULTS:
TEST                      RESULT      UNITS      REFERENCE      FLAG
NT-proBNP                 8,450       pg/mL      <300           H
Troponin I                0.04        ng/mL      <0.03          H
Sodium                    131         mmol/L     135-145        L
Potassium                 4.9         mmol/L     3.5-5.0
Creatinine                1.6         mg/dL      0.7-1.3        H
Hemoglobin                12.9        g/dL       13.5-17.5      L

INTERPRETATION:
Markedly elevated NT-proBNP consistent with heart failure. Troponin minimally elevated and flat on repeat, consistent with demand. Creatinine above baseline of 1.3 mg/dL.`,
    },
    {
      key: "echo", type: "IMAGING_REPORT", title: "Transthoracic echocardiogram", days: 2, time: "15:00", uploadedBy: "brooks",
      text: `${SYNTHETIC_HEADER}

ECHOCARDIOGRAM REPORT
DATE OF STUDY: ${fmt(day(2))}
PATIENT: Samuel Okafor | MRN: SYN-100689

IMPRESSION:
1. Severely reduced left ventricular systolic function; LVEF 25% by biplane method.
2. Dilated left ventricle with regional wall motion abnormalities in the LAD territory.
3. Moderate functional mitral regurgitation.
4. Estimated right ventricular systolic pressure 48 mmHg.`,
    },
    {
      key: "nursing", type: "CLINICAL_NOTE", title: "Nursing shift note (day)", days: 1, time: "18:45", uploadedBy: "adams",
      text: `${SYNTHETIC_HEADER}

NURSING SHIFT NOTE (DAY SHIFT 07:00-19:00)
DATE: ${fmt(day(1))}
NURSE: Rachel Adams, RN

SITUATION:
Diuresing well on IV furosemide; net negative 2.4 L in 24 hours. Weight down 2.1 kg from admission.

BACKGROUND:
Admitted with acute decompensated heart failure, LVEF 25%.

ASSESSMENT:
BP 124/78, HR 88, SpO2 95% on 2 L nasal cannula. Mild bibasilar crackles. Potassium 3.6 mmol/L this morning.

PENDING:
- Evening basic metabolic panel.
- Cardiology decision on restarting ACE inhibitor or ARNI.

RISKS:
- Hypokalemia with ongoing diuresis.
- Worsening kidney function.
- Falls: nocturia and orthostasis.

RECOMMENDATIONS FOR NEXT SHIFT:
- Strict intake and output; daily weight before breakfast.
- Replace potassium per protocol if below 4.0 mmol/L.
- Notify physician for urine output below 0.5 mL/kg/h or SpO2 below 92%.`,
    },
  ],
  messages: [
    { author: "brooks", at: [3, "07:40"], content: "Admitted overnight with ADHF after running out of furosemide. @RachelAdams strict I/O and daily weights please.", mentions: ["adams"] },
    { askAI: "Summarize the echocardiogram.", author: "brooks", at: [2, "15:20"] },
    { author: "adams", at: [1, "18:50"], content: "Net negative 2.4 L today, K 3.6 this morning. Handoff note uploaded." },
  ],
  tasks: [
    { title: "Daily weights and strict intake/output", assignee: "adams", creator: "brooks", status: "IN_PROGRESS", priority: "HIGH", due: -1, created: [3, "07:45"] },
    { title: "Medication reconciliation and GDMT plan", assignee: "brooks", creator: "brooks", status: "TODO", priority: "HIGH", due: -1, created: [2, "15:30"] },
    { title: "Heart failure education before discharge", assignee: "adams", creator: "brooks", status: "TODO", priority: "MEDIUM", due: -2, created: [2, "15:31"] },
    { title: "Book cardiology clinic follow-up within 7 days of discharge", assignee: "rivera", creator: "brooks", status: "TODO", priority: "MEDIUM", due: -4, created: [2, "15:32"] },
  ],
  summary: { status: "DRAFT", requestedBy: "brooks", at: [1, "19:00"] },
};
