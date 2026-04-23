/**
 * T94: Abstraction layer for broadcasting events to connected clients.
 *
 * In Electron mode, events are sent to BrowserWindow webContents.
 * In daemon mode, events would be sent via WebSocket to connected clients.
 *
 * This replaces direct `BrowserWindow.getAllWindows().forEach(w => w.webContents.send())`
 * calls scattered across the codebase, centralizing the broadcast mechanism.
 */

import { EventEmitter } from "node:events";

export interface EventBusTransport {
  /** Send an event to all connected clients */
  broadcast(channel: string, ...args: unknown[]): void;
}

/**
 * Electron transport: sends events to all BrowserWindow webContents.
 * Lazy-imports electron to avoid issues in non-Electron environments.
 */
class ElectronTransport implements EventBusTransport {
  broadcast(channel: string, ...args: unknown[]): void {
    try {
      // Dynamic import to avoid hard dependency on electron
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require("electron") as typeof import("electron");
      const { BrowserWindow } = electron;
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(channel, ...args);
      }
    } catch {
      // Not in Electron environment — silently ignore
    }
  }
}

/**
 * EventEmitter transport: for daemon mode or testing.
 * Clients subscribe directly to the emitter.
 */
class EmitterTransport extends EventEmitter implements EventBusTransport {
  broadcast(channel: string, ...args: unknown[]): void {
    this.emit(channel, ...args);
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let transport: EventBusTransport | null = null;

/**
 * Get the global event bus transport.
 * Defaults to ElectronTransport; call `setEventBusTransport()` to override.
 */
export function getEventBus(): EventBusTransport {
  if (!transport) {
    transport = new ElectronTransport();
  }
  return transport;
}

/**
 * Override the global transport (e.g., for daemon mode with WebSocket).
 */
export function setEventBusTransport(t: EventBusTransport): void {
  transport = t;
}

/**
 * Create an EventEmitter-based transport (for daemon mode or testing).
 */
export function createEmitterTransport(): EmitterTransport {
  return new EmitterTransport();
}

/**
 * Convenience: broadcast an event on the global bus.
 */
export function broadcast(channel: string, ...args: unknown[]): void {
  getEventBus().broadcast(channel, ...args);
}
