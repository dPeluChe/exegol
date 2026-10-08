import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractTarBz2, keepsPath, pruneToRequired, unsafeEntryReason } from "./extract";

interface Entry {
  name: string;
  type?: "0" | "1" | "2" | "5";
  body?: string;
  linkname?: string;
}

// Hand-built ustar so the test can write entries a well-behaved tar tool refuses to create
function header(entry: Entry, size: number): Buffer {
  const h = Buffer.alloc(512);
  const put = (value: string, offset: number, length: number) => h.write(value, offset, length);
  const octal = (n: number, len: number) => `${n.toString(8).padStart(len - 1, "0")}\0`;
  put(entry.name, 0, 100);
  put(octal(0o755, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(0, 12), 136, 12);
  put("        ", 148, 8);
  put(entry.type ?? "0", 156, 1);
  put(entry.linkname ?? "", 157, 100);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  let sum = 0;
  for (const byte of h) sum += byte;
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return h;
}

function tarBz2(entries: Entry[]): string {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? "");
    blocks.push(header(entry, body.length));
    if (body.length) blocks.push(body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  const dir = mkdtempSync(join(tmpdir(), "exegol-tar-"));
  const archive = join(dir, "a.tar.bz2");
  writeFileSync(archive, execFileSync("bzip2", ["-c"], { input: Buffer.concat(blocks) }));
  return archive;
}

const hasBzip2 = (() => {
  try {
    execFileSync("bzip2", ["--help"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

function target() {
  const base = mkdtempSync(join(tmpdir(), "exegol-models-"));
  return { base, tmpDir: join(base, ".tmp-m"), destDir: join(base, "m") };
}

describe("unsafeEntryReason", () => {
  const info = (kind: "file" | "dir" | "link", nlink = 1) => ({
    isFile: () => kind === "file",
    isDirectory: () => kind === "dir",
    nlink,
  });

  it("accepts plain files and folders", () => {
    expect(unsafeEntryReason(info("file"))).toBeNull();
    expect(unsafeEntryReason(info("dir", 3))).toBeNull();
  });

  it("refuses links, special files and hard links", () => {
    expect(unsafeEntryReason(info("link"))).toBe("link or special file");
    expect(unsafeEntryReason(info("file", 2))).toBe("hard link");
  });
});

describe("keepsPath", () => {
  const required = ["tokens.txt", "tokenizer/vocab.json"];

  it("keeps required files and the folders that lead to them", () => {
    expect(keepsPath("tokens.txt", required)).toBe(true);
    expect(keepsPath("tokenizer", required)).toBe(true);
    expect(keepsPath("tokenizer/vocab.json", required)).toBe(true);
  });

  it("drops extras, including look-alike prefixes", () => {
    expect(keepsPath("test_wavs", required)).toBe(false);
    expect(keepsPath("test_wavs/0.wav", required)).toBe(false);
    expect(keepsPath("tokenizer/extra.json", required)).toBe(false);
    expect(keepsPath("tokens", required)).toBe(false);
  });
});

describe("pruneToRequired", () => {
  it("removes extras and links, keeps required files, never follows a link out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exegol-prune-"));
    const outside = mkdtempSync(join(tmpdir(), "exegol-outside-"));
    writeFileSync(join(outside, "keep.txt"), "x");
    writeFileSync(join(dir, "tokens.txt"), "t");
    writeFileSync(join(dir, "README.md"), "r");
    mkdirSync(join(dir, "test_wavs"));
    writeFileSync(join(dir, "test_wavs", "0.wav"), "w");
    mkdirSync(join(dir, "tokenizer"));
    writeFileSync(join(dir, "tokenizer", "vocab.json"), "{}");
    writeFileSync(join(dir, "tokenizer", "extra.json"), "{}");
    symlinkSync(outside, join(dir, "linked"));
    const removed = await pruneToRequired(dir, ["tokens.txt", "tokenizer/vocab.json"]);
    expect(removed.sort()).toEqual(["README.md", "linked", "test_wavs", "tokenizer/extra.json"]);
    expect(existsSync(join(dir, "tokens.txt"))).toBe(true);
    expect(existsSync(join(dir, "tokenizer", "vocab.json"))).toBe(true);
    expect(existsSync(join(outside, "keep.txt"))).toBe(true);
  });
});

describe.skipIf(!hasBzip2)("extractTarBz2", () => {
  it("keeps only the required files", async () => {
    const archive = tarBz2([
      { name: "root/tokens.txt", body: "a" },
      { name: "root/test_wavs/0.wav", body: "wav" },
      { name: "root/README.md", body: "r" },
    ]);
    const t = target();
    await extractTarBz2({ archive, ...t, rootDir: "root", requiredFiles: ["tokens.txt"] });
    expect(existsSync(join(t.destDir, "tokens.txt"))).toBe(true);
    expect(existsSync(join(t.destDir, "test_wavs"))).toBe(false);
    expect(existsSync(join(t.destDir, "README.md"))).toBe(false);
  });

  it("unpacks into the model folder with nothing executable, and cleans the temp dir", async () => {
    const archive = tarBz2([
      { name: "root/", type: "5" },
      { name: "root/tokens.txt", body: "a b c" },
      { name: "root/model.onnx", body: "weights" },
    ]);
    const t = target();
    await extractTarBz2({
      archive,
      ...t,
      rootDir: "root",
      requiredFiles: ["tokens.txt", "model.onnx"],
    });
    expect(readFileSync(join(t.destDir, "tokens.txt"), "utf-8")).toBe("a b c");
    expect(statSync(join(t.destDir, "model.onnx")).mode & 0o111).toBe(0);
    expect(existsSync(t.tmpDir)).toBe(false);
  });

  it("refuses a traversal entry and writes nothing outside", async () => {
    const archive = tarBz2([
      { name: "root/tokens.txt", body: "ok" },
      { name: "root/../../escaped.txt", body: "pwned" },
    ]);
    const t = target();
    await expect(
      extractTarBz2({ archive, ...t, rootDir: "root", requiredFiles: ["tokens.txt"] }),
    ).rejects.toThrow(/refused/);
    expect(existsSync(join(t.base, "escaped.txt"))).toBe(false);
    expect(existsSync(join(t.base, "..", "escaped.txt"))).toBe(false);
    expect(existsSync(t.destDir)).toBe(false);
  });

  it("refuses a symlink entry", async () => {
    const archive = tarBz2([
      { name: "root/tokens.txt", body: "ok" },
      { name: "root/evil", type: "2", linkname: "/etc" },
    ]);
    const t = target();
    await expect(
      extractTarBz2({ archive, ...t, rootDir: "root", requiredFiles: ["tokens.txt"] }),
    ).rejects.toThrow(/refused/);
    expect(existsSync(t.destDir)).toBe(false);
  });

  it("refuses a hard link entry", async () => {
    const archive = tarBz2([
      { name: "root/tokens.txt", body: "ok" },
      { name: "root/copy", type: "1", linkname: "root/tokens.txt" },
    ]);
    const t = target();
    await expect(
      extractTarBz2({ archive, ...t, rootDir: "root", requiredFiles: ["tokens.txt"] }),
    ).rejects.toThrow(/hard link/);
    expect(existsSync(t.destDir)).toBe(false);
  });

  it("fails when a required file is missing, leaving no half model", async () => {
    const archive = tarBz2([{ name: "root/tokens.txt", body: "ok" }]);
    const t = target();
    await expect(
      extractTarBz2({ archive, ...t, rootDir: "root", requiredFiles: ["model.onnx"] }),
    ).rejects.toThrow(/missing model.onnx/);
    expect(existsSync(t.destDir)).toBe(false);
  });
});
