/** A process listening on a TCP port, as the Monitor's dev-server list shows it */
export interface DevServer {
  pid: number;
  ports: number[];
  /** Short process name from lsof (node, bun, python3...) */
  process: string;
  /** Full command line, for the tooltip */
  command: string;
  /** Seconds since the process started */
  uptimeSeconds: number | null;
  cwd: string | null;
  /** Exegol project whose folder holds the process's cwd */
  project: { id: string; name: string } | null;
  /** Exegol agent or shell whose terminal started it (found up the parent chain) */
  agent: { id: string; projectId: string; cliType: string; alias: string | null } | null;
  /** Another process listens on one of these ports too */
  conflict: boolean;
}
