import { expect, it } from "vitest";
import { joinable } from "./colab-room";

const projects = [
  { id: "t", name: "tasky" },
  { id: "b", name: "Blueprints" },
  { id: "i", name: "Irma Projects" },
];

it("lists projects by name whatever their case, marks whole-project members, and searches", () => {
  const members = [
    { projectId: "b", repo: "" },
    { projectId: "i", repo: "landing" },
  ];
  expect(joinable(projects, members, "").map((j) => [j.project.name, j.joined])).toEqual([
    ["Blueprints", true],
    ["Irma Projects", false],
    ["tasky", false],
  ]);
  expect(joinable(projects, members, " IRMA ").map((j) => j.project.id)).toEqual(["i"]);
});
