// Local test builds (`bun run package:local`) carry `<next patch>-test.<sha>[.dirty]`: semver puts
// that above the release it was built from and below the next one, and the app badges it.
export interface TestBuild {
  commit: string;
  dirty: boolean;
}

const TEST_VERSION = /^\d+\.\d+\.\d+-test\.([0-9a-z]+)(\.dirty)?$/i;

/** `0.5.20` + `171da0d` → `0.5.21-test.171da0d` (null when `base` is not x.y.z) */
export function testBuildVersion(base: string, sha: string, dirty: boolean): string | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(base);
  if (!m || !/^[0-9a-f]{4,40}$/i.test(sha)) return null;
  // An all-digit sha with a leading zero is not a valid semver identifier: git describe's `g`
  const id = /^\d+$/.test(sha) ? `g${sha}` : sha;
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}-test.${id}${dirty ? ".dirty" : ""}`;
}

export function testBuildOf(version: string): TestBuild | null {
  const m = TEST_VERSION.exec(version);
  if (!m?.[1]) return null;
  return { commit: m[1].replace(/^g(?=\d+$)/, ""), dirty: !!m[2] };
}
