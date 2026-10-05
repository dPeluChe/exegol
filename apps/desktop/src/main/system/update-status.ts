/** The updater's last status. Its own module: the auto-updater reads the app version on load */
export interface UpdateStatus {
  status: string;
  info: {
    version?: string;
    percent?: number;
    transferred?: number;
    total?: number;
    message?: string;
  };
}

let lastStatus: UpdateStatus = { status: "idle", info: {} };

/** The last status sent, so a window that mounts mid-download still shows it */
export function getUpdateStatus(): UpdateStatus {
  return lastStatus;
}

export function setUpdateStatus(status: string, info: UpdateStatus["info"]): UpdateStatus {
  // "downloading" carries no version: keep the one the update was found with
  lastStatus = { status, info: { ...info, version: info.version ?? lastStatus.info.version } };
  return lastStatus;
}
