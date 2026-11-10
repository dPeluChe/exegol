import { expect, it } from "vitest";
import { noteSpokenWith, spokenWith } from "./spoken-with";

it("remembers the voice a reply was last read with", () => {
  const how = { voice: "em_alex", speed: 1, model: "kokoro" };
  noteSpokenWith(["Hola.", "Listo."], how);
  noteSpokenWith(["Hola.", "Listo."], { ...how, voice: "ef_dora" });
  expect(spokenWith(["Hola.", "Listo."])?.voice).toBe("ef_dora");
  expect(spokenWith(["Hola."])).toBeUndefined();
});
