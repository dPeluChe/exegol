// Main process client for the PTY sidecar.
// JSON-RPC over Unix domain socket (NDJSON framing).

import { connect, type Socket } from "node:net";
import {
  type JsonRpcMessage,
  type JsonRpcResponse,
  makeRequest,
  type PingResult,
  type SessionCreateParams,
  type SessionCreateResult,
  type SessionDataNotification,
  type SessionErrorNotification,
  type SessionExitNotification,
  type SessionInfo,
  type SessionListInfoResult,
  type SessionListResult,
  type SessionMemoryResult,
  type SessionSnapshotResult,
} from "./pty-sidecar-protocol";

type DataCallback = (id: string, data: string) => void;
type ExitCallback = (id: string, exitCode: number, signal?: number) => void;
type ErrorCallback = (id: string, message: string) => void;

export class SidecarClient {
  private socket: Socket | null = null;
  private buffer = "";
  private pendingRequests = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private nextId = 1;
  private dataCallbacks: DataCallback[] = [];
  private exitCallbacks: ExitCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];
  private connected = false;

  async connect(sockPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = connect(sockPath);
      const timeout = setTimeout(() => {
        sock.destroy();
        reject(new Error("Sidecar connection timeout"));
      }, 5_000);

      sock.on("connect", () => {
        clearTimeout(timeout);
        this.socket = sock;
        this.connected = true;
        resolve();
      });

      sock.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString("utf-8");
        this.processBuffer();
      });

      sock.on("close", () => {
        this.connected = false;
        this.socket = null;
        // Reject all pending requests
        for (const [, pending] of this.pendingRequests) {
          pending.reject(new Error("Sidecar connection closed"));
        }
        this.pendingRequests.clear();
      });

      sock.on("error", (err) => {
        clearTimeout(timeout);
        if (!this.connected) {
          reject(err);
        }
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ─── Event subscriptions ───────────────────────────────────────────

  onSessionData(cb: DataCallback): void {
    this.dataCallbacks.push(cb);
  }

  onSessionExit(cb: ExitCallback): void {
    this.exitCallbacks.push(cb);
  }

  onSessionError(cb: ErrorCallback): void {
    this.errorCallbacks.push(cb);
  }

  // ─── RPC methods ───────────────────────────────────────────────────

  async ping(): Promise<PingResult> {
    return this.call("ping") as Promise<PingResult>;
  }

  async createSession(params: SessionCreateParams): Promise<SessionCreateResult> {
    return this.call("session.create", params) as Promise<SessionCreateResult>;
  }

  async write(id: string, data: string): Promise<void> {
    await this.call("session.write", { id, data });
  }

  async resize(id: string, cols: number, rows: number): Promise<void> {
    await this.call("session.resize", { id, cols, rows });
  }

  async kill(id: string): Promise<void> {
    await this.call("session.kill", { id });
  }

  async destroy(id: string): Promise<void> {
    await this.call("session.destroy", { id });
  }

  async snapshot(id: string): Promise<string | null> {
    const result = (await this.call("session.snapshot", { id })) as SessionSnapshotResult;
    return result.data;
  }

  async listSessions(): Promise<string[]> {
    const result = (await this.call("session.list")) as SessionListResult;
    return result.sessions;
  }

  /** Returns sessions with their alive flag + exit info (for crash recovery) */
  async listSessionsInfo(): Promise<SessionInfo[]> {
    const result = (await this.call("session.listInfo")) as SessionListInfoResult;
    return result.sessions;
  }

  /** T143: per-session ring buffer memory usage, for Monitor > Resources */
  async getMemoryInfo(): Promise<SessionMemoryResult> {
    return this.call("session.memory") as Promise<SessionMemoryResult>;
  }

  async shutdown(): Promise<void> {
    await this.call("shutdown");
  }

  // ─── Internal ──────────────────────────────────────────────────────

  private call(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new Error("Not connected to sidecar"));
        return;
      }
      const id = this.nextId++;
      // Per-request timeout (10s) to prevent indefinite hangs if sidecar is unresponsive
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Sidecar RPC timeout: ${method}`));
      }, 10_000);
      this.pendingRequests.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      const msg = makeRequest(method, params);
      const parsed = JSON.parse(msg.trim());
      parsed.id = id;
      try {
        this.socket.write(`${JSON.stringify(parsed)}\n`);
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err as Error);
      }
    });
  }

  private processBuffer(): void {
    for (;;) {
      const newlineIdx = this.buffer.indexOf("\n");
      if (newlineIdx === -1) break;
      const line = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        this.handleMessage(msg);
      } catch {
        // Malformed — skip
      }
    }
  }

  private handleMessage(msg: JsonRpcMessage): void {
    // Response to our request
    if ("id" in msg && !("method" in msg)) {
      const resp = msg as JsonRpcResponse;
      const pending = this.pendingRequests.get(resp.id);
      if (pending) {
        this.pendingRequests.delete(resp.id);
        if (resp.error) {
          pending.reject(new Error(resp.error.message));
        } else {
          pending.resolve(resp.result);
        }
      }
      return;
    }

    // Notification from sidecar
    if ("method" in msg && !("id" in msg)) {
      switch (msg.method) {
        case "session.data": {
          const p = msg.params as SessionDataNotification;
          for (const cb of this.dataCallbacks) cb(p.id, p.data);
          break;
        }
        case "session.exit": {
          const p = msg.params as SessionExitNotification;
          for (const cb of this.exitCallbacks) cb(p.id, p.exitCode, p.signal);
          break;
        }
        case "session.error": {
          const p = msg.params as SessionErrorNotification;
          for (const cb of this.errorCallbacks) cb(p.id, p.message);
          break;
        }
      }
    }
  }
}
