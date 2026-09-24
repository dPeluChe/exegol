import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getVersion: () => "0.5.0", isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock("electron-updater", () => ({ autoUpdater: { on: vi.fn() } }));

import { silencedReason } from "./auto-updater";

/** The exact error a packaged 0.5.0 showed as "Update error" (no release published yet). */
function noReleaseError(): Error {
  const err = new Error(
    'Cannot find channel "latest-mac.yml" update info: HttpError: 404 \n"method: GET url: https://github.com/dPeluChe/exegol/releases/latest/download/latest-mac.yml?noCache=1k3ad1rkn"',
  );
  return Object.assign(err, { code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND" });
}

describe("silencedReason", () => {
  it("silences a repo with no published release, by code or by message", () => {
    expect(silencedReason(noReleaseError())).toMatch(/No published release/);
    const bare = new Error(noReleaseError().message);
    expect(silencedReason(bare)).toMatch(/No published release/);
    expect(silencedReason(Object.assign(new Error("x"), { statusCode: 404 }))).toMatch(
      /No published release/,
    );
  });

  it("silences network failures", () => {
    expect(silencedReason(new Error("net::ERR_INTERNET_DISCONNECTED"))).toMatch(/Network/);
  });

  it("lets a real updater failure through", () => {
    expect(silencedReason(new Error("sha512 checksum mismatch"))).toBeNull();
  });
});
