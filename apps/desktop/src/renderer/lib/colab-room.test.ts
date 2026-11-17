import { expect, it } from "vitest";
import { joinable } from "./colab-room";

const projects = [
  { id: "t", name: "tasky" },
  { id: "b", name: "Blueprints" },
  { id: "i", name: "Irma Projects", path: "/work/clients" },
];

it("lists projects by name whatever their case, leaves out whole-project members, and searches name and path", () => {
  const members = [
    { projectId: "b", repo: "" },
    { projectId: "i", repo: "landing" },
  ];
  expect(joinable(projects, members, "").map((p) => p.name)).toEqual(["Irma Projects", "tasky"]);
  expect(joinable(projects, members, " IRMA ").map((p) => p.id)).toEqual(["i"]);
  expect(joinable(projects, members, "clients").map((p) => p.id)).toEqual(["i"]);
});
