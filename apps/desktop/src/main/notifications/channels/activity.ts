import type { NotificationEvent } from "@exegol/shared";
import type Database from "libsql";
import { insertActivity } from "../../db/queries/activities";
import type { NotificationChannel } from "../bus";

let dbRef: Database.Database | null = null;

export function setActivityChannelDb(db: Database.Database): void {
  dbRef = db;
}

/** The sidebar feed; sessions log their own lifecycle, so `agent:*` stays out of it */
export const activityChannel: NotificationChannel = {
  id: "activity",
  deliver(event: NotificationEvent): void {
    if (!dbRef || event.type.startsWith("agent:")) return;
    insertActivity(dbRef, {
      type: event.type as Exclude<NotificationEvent["type"], `agent:${string}`>,
      entityType: "notification",
      entityId: event.agentId,
      projectId: event.projectId,
      description: event.body ? `${event.title}: ${event.body}` : event.title,
    });
  },
};
