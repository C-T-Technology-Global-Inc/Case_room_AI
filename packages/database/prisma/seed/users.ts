import type { UserRole } from "@ccr/types";

export const DEMO_PASSWORD = "demo1234";

export interface DemoUser {
  key: string;
  name: string;
  email: string;
  handle: string;
  role: UserRole;
  specialty: string | null;
  title: string;
}

/** Synthetic care team of the demo organization. */
export const DEMO_USERS: DemoUser[] = [
  { key: "admin", name: "Alex Morgan", email: "admin@riverside.demo", handle: "AlexMorgan", role: "ORG_ADMIN", specialty: null, title: "Clinical Operations Director" },
  { key: "nguyen", name: "Dr. Minh Nguyen", email: "nguyen@riverside.demo", handle: "DrNguyen", role: "DOCTOR", specialty: "Medical Oncology", title: "Medical Oncologist" },
  { key: "lee", name: "Dr. Daniel Lee", email: "lee@riverside.demo", handle: "DrLee", role: "SPECIALIST", specialty: "Radiology", title: "Radiologist" },
  { key: "smith", name: "Dr. Emily Smith", email: "smith@riverside.demo", handle: "DrSmith", role: "SPECIALIST", specialty: "Surgical Oncology", title: "Surgical Oncologist" },
  { key: "patel", name: "Dr. Priya Patel", email: "patel@riverside.demo", handle: "DrPatel", role: "SPECIALIST", specialty: "Pathology", title: "Pathologist" },
  { key: "obrien", name: "Dr. James O'Brien", email: "obrien@riverside.demo", handle: "DrOBrien", role: "SPECIALIST", specialty: "Radiation Oncology", title: "Radiation Oncologist" },
  { key: "brooks", name: "Dr. Hannah Brooks", email: "brooks@riverside.demo", handle: "DrBrooks", role: "DOCTOR", specialty: "Cardiology", title: "Cardiologist" },
  { key: "adams", name: "Rachel Adams", email: "adams@riverside.demo", handle: "RachelAdams", role: "NURSE", specialty: "Oncology Nursing", title: "Registered Nurse" },
  { key: "rivera", name: "Carlos Rivera", email: "rivera@riverside.demo", handle: "CarlosRivera", role: "CARE_COORDINATOR", specialty: "Care Coordination", title: "Nurse Navigator" },
];
