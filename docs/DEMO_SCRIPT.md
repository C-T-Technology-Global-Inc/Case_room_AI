# 5-minute demo script

Goal: show an investor or physician that this is **one patient, one shared case, the whole care team, and an AI that helps all of them, with evidence and human approval.**

## Setup (before the meeting)

1. `npm run db:seed` for a fresh dataset (dates are relative to today).
2. `npm run dev`.
3. **Window A** (normal profile): sign in as **Dr. Minh Nguyen** (medical oncologist).
4. **Window B** (second profile or private window): sign in as **Dr. Emily Smith** (surgical oncologist).
5. In both windows open **Cases → John Carter** (pancreatic head mass). Place the windows side by side.

## Script

**1. "This is one patient." (30 s)** — Window A, *Overview*.
Point at the header: synthetic patient, 56-year-old, pancreatic adenocarcinoma, status *Decision pending*, the care team avatars (Window B's presence dot is green: "2 viewing").

**2. "This is everything the team knows." (60 s)**
- The **AI case summary** (labeled *AI Generated · Draft*): current status, diagnosis, treatment, key findings, each with a source chip. Click a chip: the verified excerpt appears, then *Open source* opens the pathology report.
- Scroll to **Missing information** and **Shared patient memory**.
- Open **Timeline**: CT → CA 19-9 → biopsy → pathology → consults → admission → ERCP. Every event links to its document.

**3. "This is the team collaborating." (60 s)** — both windows on *Discussion*.
In Window A type `@AI compare the pathology with the latest CT` and press Enter.
Window B shows *Dr. Nguyen is typing…*, then *AI is reviewing the case record…*, then the answer, at the same moment as Window A.

**4. "AI helps the whole team, with evidence." (45 s)**
Point at the answer: numbered citations, the **Sources** list, **confidence** and **limitations**. Hover a citation to show the verbatim excerpt. Ask a question the record cannot answer (for example `@AI what did the liver transplant evaluation conclude?`): the AI says the information is not in the record instead of inventing it.

**5. "This is the proposed decision." (45 s)** — Window A, *Decisions*.
Decision #1, *Neoadjuvant chemotherapy before surgical re-evaluation*: rationale, sources, approvals 2 of 3 (radiology and pathology approved, surgery pending).

**6. "And this is where humans approve it." (45 s)** — Window B, *Decisions*.
Dr. Smith clicks **Approve**, adds a comment, confirms. Window A updates live: *Final human-approved decision*, recorded after approval by all three reviewers; the case status moves to *Reviewing*. Then in Window A click **Suggest follow-up tasks**: the AI proposes tasks; the physician selects and creates them (flagged *AI-suggested*).

**7. Close (15 s)** — *Audit Log* tab: every upload, AI answer, approval and task is recorded, append-only.

## Optional extras

- **Tumor Board** tab → *Prepare tumor board*: a full brief with *Questions for tumor board*; edit a section, then *Approve & share*.
- Sign in as **Rachel Adams (nurse)** → *Handoff* → *Generate new handoff*: changes since last shift (hemoglobin trend), pending results, risks and next actions; the nurse approves it.
- **Upload document** → *Paste text* with a new report: the timeline and memory update automatically.
- **Settings**: show the AI provider switch (Anthropic, OpenAI or offline) and the safety guarantees.
