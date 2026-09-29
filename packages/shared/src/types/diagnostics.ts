/** T196: a redacted bug report, as collected in main and reviewed in the dialog. */
export interface BugDiagnostics {
  /** Full redacted report (markdown) */
  text: string;
  /** The DevTools console of Exegol's windows, redacted, for its own copy button */
  console: string;
  version: string;
  /** Last error line, redacted: the default issue title */
  lastError: string | null;
}

export type DoctorStatus = "ok" | "warn" | "fail";

/** Grouping for the Doctor UI: agent CLIs vs system services/deps vs configuration. */
export type DoctorCategory = "agents" | "system" | "config";

/** One Doctor result, shared by main (which runs it) and the renderer (which shows it) */
export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  actionUrl?: string;
  /** Agent CLIs: the vendor's install command (shown to copy when missing) */
  installCommand?: string;
  /** Agent CLIs: the vendor's update command (shown to copy when installed) */
  updateCommand?: string;
  /** Optional for reports from an older main process; the UI derives it from the id */
  category?: DoctorCategory;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  generatedAt: number;
}
