import { describe, expect, it } from "vitest";
import { startedBeforeLogin } from "./login-session";

const LOGIN = "/System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow";
const table = (sidecar: string, login: string) =>
  [
    `  501   836 ${sidecar} /Applications/Exegol.app/Contents/MacOS/Exegol`,
    `  501 33922 ${login} ${LOGIN}`,
  ].join("\n");

describe("startedBeforeLogin", () => {
  it("is true for a sidecar older than the login session", () => {
    expect(startedBeforeLogin(table("02-10:08:12", "07:59:14"), 501, 836)).toBe(true);
  });

  it("is false for one started after the login", () => {
    expect(startedBeforeLogin(table("07:58:00", "07:59:14"), 501, 836)).toBe(false);
  });

  it("takes the user's newest loginwindow and no other user's", () => {
    const rows = `${table("01:00:00", "02:00:00")}\n  502   900       00:10 ${LOGIN}`;
    expect(startedBeforeLogin(rows, 501, 836)).toBe(false);
    expect(startedBeforeLogin(`${rows}\n  501   901       30:00 ${LOGIN}`, 501, 836)).toBe(true);
  });

  it("is false when the sidecar or the login is not in the table", () => {
    expect(startedBeforeLogin(table("02:00:00", "01:00:00"), 501, 999)).toBe(false);
    expect(startedBeforeLogin("  501   836 02:00:00 /x/Exegol", 501, 836)).toBe(false);
  });
});
