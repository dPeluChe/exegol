import { hostOf, INBOX_BODY_MAX, INBOX_TITLE_MAX, type InboxThread } from "@exegol/shared";
import type Database from "libsql";
import { getThread, insertThread } from "../db/queries/inbox";
import { InboxError, type InboxTarget, notifyInboxChanged, PERSON, placed } from "./threads";

const CAPTURED = { ...PERSON, authorKind: "external" as const };

export interface CaptureFields {
  title: string | null;
  url: string | null;
  text: string | null;
  /** The person's own line, said in the dialog */
  note: string | null;
}

function titleOf({ title, url, text }: CaptureFields): string {
  const host = url ? hostOf(url) : null;
  return (title || text?.split("\n")[0] || host || "Captured").trim().slice(0, INBOX_TITLE_MAX);
}

/** What the person confirmed in the capture dialog, as a thread to review later */
export function capture(
  db: Database.Database,
  target: InboxTarget,
  fields: CaptureFields,
): InboxThread {
  const url = fields.url && /^https?:\/\//i.test(fields.url) ? fields.url : null;
  const body = [fields.note, fields.text, url]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, INBOX_BODY_MAX);
  if (!body) throw new InboxError("Nothing to capture");
  const { scopeId, toProject, owner } = placed(db, PERSON, target);
  const key = insertThread(
    db,
    {
      scope: target.scope,
      scopeId,
      toProject,
      ownerProject: owner,
      title: titleOf(fields),
      url,
      refs: [],
      kind: "capture",
    },
    body,
    CAPTURED,
  );
  notifyInboxChanged();
  return getThread(db, key, null) as InboxThread;
}
