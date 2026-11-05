import type { NotificationEventType } from "./agent-signals";

export type ActivityType =
  | "agent_spawned"
  | "agent_stopped"
  | "agent_completed"
  | "agent_failed"
  | "scheduler_fired"
  | "port_detected"
  | Exclude<NotificationEventType, `agent:${string}`>;

export type Activity = {
  id: string;
  type: ActivityType;
  entityType: string;
  entityId: string | null;
  projectId: string | null;
  description: string;
  createdAt: number;
};
