import type { WebglCounts } from "@exegol/shared";

/** Apart from terminal-webgl: the project switch log loads at startup, xterm must not */
export const counts: WebglCounts = { attached: 0, reused: 0, evicted: 0 };

/** Counted since load, read as differences by the project switch log */
export const webglCounts = (): WebglCounts => ({ ...counts });
