import { describe, expect, it } from "vitest";
import { cleanDictation, dictationVocabulary, parseVocabulary } from "./dictation";
import { applySpokenPunctuation as p } from "./dictation-punctuation";

describe("applySpokenPunctuation: Spanish", () => {
  it("turns the marks into punctuation with the spacing fixed", () => {
    expect(p("hola coma qué tal")).toBe("hola, qué tal");
    expect(p("primero punto y coma segundo")).toBe("primero; segundo");
    expect(p("lo siguiente dos puntos lint y tests")).toBe("lo siguiente: lint y tests");
    expect(p("abre el pull request punto final")).toBe("abre el pull request.");
  });

  it("absorbs the punctuation the model wrote at the pause", () => {
    expect(p("Hola, coma, qué tal")).toBe("Hola, qué tal");
    expect(p("Abre el archivo punto. Luego guarda")).toBe("Abre el archivo. Luego guarda");
    expect(p("Hola coma. qué tal")).toBe("Hola, qué tal");
  });

  it("capitalizes after a sentence end", () => {
    expect(p("listo punto final ahora el lint")).toBe("listo. Ahora el lint");
    expect(p("listo punto y seguido ahora el lint")).toBe("listo. Ahora el lint");
    expect(p("abre interrogación qué pasa cierra interrogación")).toBe("¿Qué pasa?");
    expect(p("hola punto final abre exclamación genial cierra exclamación")).toBe("hola. ¡Genial!");
  });

  it("question and exclamation marks", () => {
    expect(p("funciona signo de interrogación")).toBe("funciona?");
    expect(p("dime abre signo de interrogación funciona cierra signo de interrogación")).toBe(
      "dime ¿funciona?",
    );
    expect(p("genial signo de exclamación")).toBe("genial!");
  });

  it("line breaks and paragraphs, accents optional", () => {
    expect(p("uno nueva línea dos")).toBe("uno\nDos");
    expect(p("uno salto de linea dos")).toBe("uno\nDos");
    expect(p("uno nuevo párrafo dos")).toBe("uno\n\nDos");
    expect(p("uno. Nuevo parrafo. Dos")).toBe("uno.\n\nDos");
    expect(p("fin punto y aparte sigue")).toBe("fin.\n\nSigue");
  });

  it("'punto' alone counts only before a pause, a capital, the end or another command", () => {
    expect(p("abre el archivo punto")).toBe("abre el archivo.");
    expect(p("abre el archivo punto Luego")).toBe("abre el archivo. Luego");
    expect(p("hecho punto nueva línea sigue")).toBe("hecho.\nSigue");
    expect(p("google punto com")).toBe("google punto com");
    expect(p("ve a punto de venta")).toBe("ve a punto de venta");
  });

  it("an article or determiner keeps the word", () => {
    expect(p("el punto es que falla")).toBe("el punto es que falla");
    expect(p("quita la coma del final")).toBe("quita la coma del final");
    expect(p("añade una nueva línea al archivo")).toBe("añade una nueva línea al archivo");
    expect(p("tiene los dos puntos")).toBe("tiene los dos puntos");
  });

  it("'dos puntos de' stays words", () => {
    expect(p("hay dos puntos de vista")).toBe("hay dos puntos de vista");
  });

  it("whole words only", () => {
    expect(p("el comando compila")).toBe("el comando compila");
    expect(p("puntos comas y comata")).toBe("puntos comas y comata");
    expect(p("COMA final")).toBe(", final");
  });
});

describe("applySpokenPunctuation: English", () => {
  it("marks and breaks", () => {
    expect(p("hello comma world")).toBe("hello, world");
    expect(p("first semicolon second colon third")).toBe("first; second: third");
    expect(p("is it done question mark")).toBe("is it done?");
    expect(p("great exclamation mark")).toBe("great!");
    expect(p("great exclamation point")).toBe("great!");
    expect(p("done full stop next one")).toBe("done. Next one");
    expect(p("one new line two")).toBe("one\nTwo");
    expect(p("one new paragraph two")).toBe("one\n\nTwo");
  });

  it("'period' only as a sentence end", () => {
    expect(p("ship it period")).toBe("ship it.");
    expect(p("Ship it. Period. Then merge")).toBe("Ship it. Then merge");
    expect(p("the trial period ends")).toBe("the trial period ends");
    expect(p("a period of time")).toBe("a period of time");
  });

  it("a determiner keeps the word", () => {
    expect(p("add a new line here")).toBe("add a new line here");
    expect(p("remove the comma")).toBe("remove the comma");
  });

  it("mixed with Spanish and English dev terms", () => {
    expect(p("haz commit coma push y abre el pull request punto")).toBe(
      "haz commit, push y abre el pull request.",
    );
  });
});

describe("applySpokenPunctuation: edges", () => {
  it("text without commands is returned as is", () => {
    expect(p("abre el pull request del worktree")).toBe("abre el pull request del worktree");
    expect(p("")).toBe("");
  });

  it("a command at the start, or the same mark twice (collapses)", () => {
    expect(p("coma hola")).toBe(", hola");
    expect(p("hola coma coma adiós")).toBe("hola, adiós");
    expect(p("nueva línea nueva línea hola")).toBe("\n\nHola");
  });

  it("keeps a trailing line break from a command", () => {
    expect(p("hola nueva línea")).toBe("hola\n");
  });
});

describe("cleanDictation", () => {
  it("sanitizes, then applies spoken punctuation only when on", () => {
    expect(cleanDictation(" hola\x1b[201~ coma adiós ", { spokenPunctuation: true })).toBe(
      "hola[201~, adiós",
    );
    expect(cleanDictation("hola coma adiós", { spokenPunctuation: false })).toBe("hola coma adiós");
  });
});

describe("vocabulary", () => {
  it("one term per line: trimmed, deduped, separators made spaces, capped", () => {
    expect(parseVocabulary(" worktree \n\npull request\nworktree\nfoo,bar/baz:qux\n")).toEqual([
      "worktree",
      "pull request",
      "foo bar baz qux",
    ]);
    expect(parseVocabulary("x".repeat(80))[0]).toHaveLength(64);
    const many = Array.from({ length: 300 }, (_, i) => `t${i}`).join("\n");
    expect(parseVocabulary(many)).toHaveLength(200);
  });

  it("the project's terms add to the global list", () => {
    const settings = { vocabulary: ["Exegol", "worktree"], projectVocabulary: { p1: ["Biome"] } };
    expect(dictationVocabulary(settings, "p1")).toEqual(["Exegol", "worktree", "Biome"]);
    expect(dictationVocabulary(settings, "p2")).toEqual(["Exegol", "worktree"]);
    expect(dictationVocabulary(settings, null)).toEqual(["Exegol", "worktree"]);
  });
});
