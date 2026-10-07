import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { scriptTargetExists } from "./detect";

const dir = mkdtempSync(join(tmpdir(), "exegol-ide-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function script(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

describe("scriptTargetExists", () => {
  it("rejects a launcher script whose app is gone", () => {
    const path = script(
      "idea",
      `#!/bin/bash\nopen -na "${dir}/IntelliJ IDEA.app/Contents/MacOS/idea" --args "$@"\n`,
    );
    expect(scriptTargetExists(path)).toBe(false);
  });
  it("accepts one whose bin/ target exists", () => {
    mkdirSync(join(dir, "bin"));
    script("bin/idea.sh", "#!/bin/sh\n");
    const path = script("idea2", `#!/bin/sh\nexec ${dir}/bin/idea.sh "$@"\n`);
    expect(scriptTargetExists(path)).toBe(true);
  });
  it("trusts a binary", () => {
    expect(scriptTargetExists(script("native", "\x7fELF..."))).toBe(true);
  });
});
