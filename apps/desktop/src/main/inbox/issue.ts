import { inboxProjectOf } from "@exegol/shared";
import type Database from "libsql";
import { setThreadUrl } from "../db/queries/inbox";
import { getProject } from "../db/queries/projects";
import { ghCreateIssue, ghSignedIn } from "../integrations/github/gh";
import { projectRepos } from "../integrations/github/repos";
import { transcript } from "./forward";
import { InboxError, openThreadOrThrow, PERSON, replyTo } from "./threads";

export const ISSUE_BODY_MAX = 60_000;

function openThreadWithProject(db: Database.Database, key: string) {
  const thread = openThreadOrThrow(db, key);
  const project = getProject(db, inboxProjectOf(thread) ?? "");
  if (!project)
    throw new InboxError("A personal thread has no repo: forward it to a project first");
  return { thread, project };
}

/** What the person reviews before anything is public: the project's GitHub repos and a body */
export async function issueDraft(db: Database.Database, key: string) {
  const { thread, project } = openThreadWithProject(db, key);
  const repos = (await projectRepos(project.path)).map((r) => r.name);
  return { repos, title: thread.title, body: transcript(db, thread, `From Exegol inbox ${key}.`) };
}

export interface IssueFields {
  repo: string;
  title: string;
  body: string;
}

/** The person's text, as reviewed, on a repo of the thread's project; the thread gets the link */
export async function sendAsIssue(
  db: Database.Database,
  key: string,
  fields: IssueFields,
): Promise<string> {
  const { project } = openThreadWithProject(db, key);
  const repos = await projectRepos(project.path);
  if (!repos.some((r) => r.name === fields.repo)) {
    throw new InboxError(`${fields.repo} is not a GitHub repo of ${project.name}`);
  }
  const title = fields.title.trim();
  const body = fields.body.trim();
  if (!title || !body) throw new InboxError("An issue needs a title and a body");
  if (!(await ghSignedIn())) throw new InboxError("Sending an issue needs the gh CLI, logged in");
  const url = await ghCreateIssue(fields.repo, title, body);
  if (!/^https:\/\/github\.com\//.test(url))
    throw new InboxError("gh did not return an issue link");
  setThreadUrl(db, key, url);
  replyTo(db, PERSON, key, `Sent as issue: ${url}`);
  return url;
}
