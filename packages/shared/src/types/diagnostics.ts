/** T196: a redacted bug report, as collected in main and reviewed in the dialog. */
export interface BugDiagnostics {
  /** Full redacted report (markdown) */
  text: string;
  version: string;
  /** Last error line, redacted: the default issue title */
  lastError: string | null;
}
