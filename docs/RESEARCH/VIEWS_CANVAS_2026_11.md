# Views canvas: every view of a local web app at once (2026-11)

Research and a measured spike for T228. Nothing is built yet.

## The idea

Antonio's request (2026-11-18): with a web project running locally, see all of its views together, public and behind a login, to spot a missing component or a view that drifted from the rest. A second, lower priority idea: one URL at several widths side by side. Both fit one canvas: a row per route, a column per width.

Agreed so far:

- Thumbnails, not live pages. A view becomes a live browser only when opened.
- The canvas takes the whole work area, with no other panes beside it.
- Notes on a view that can be sent to an agent: phase 2.

## What exists

Read from each tool's own pages on 2026-11-18. Licenses not listed were not verified.

| Tool | What it does | Worth borrowing |
|------|--------------|-----------------|
| Responsively App (AGPL-3.0) | One URL in live webviews per device, mirrored input; ships an MCP server | Agent tools that mirror the UI |
| Polypane, Sizzy (proprietary) | Live panes with synced scroll, click and input; Sizzy keeps a session per pane | Sync as an option, not a default |
| Design Canvas (Mac, WebKit) | Every route of a dev server as a live frame at 1280 / 768 / 375, plus `list_routes`, `add_route`, `capture_canvas` over MCP | The three widths; captures scaled down for agents |
| Mappd | Every route in a live iframe, navigation edges from the source (links, `useNavigate`, `router.push`), pinned params and auth per route | A click on a link moves the canvas to that view; pinned params |
| Base44 canvas (hosted) | Pages as frames, a width per frame, sticky notes with a status and "Send to chat" | Notes attached to a view |
| nextmap (MIT) | Static route graph for Next.js, protected or not from the middleware matcher | Grouping by protected and public |
| Vercel toolbar, Agentation | A comment pinned to an element or a region, with selector and position for an agent | The payload of a note |

Nobody infers the values of a dynamic route (`/users/[id]`): they come from links seen in pages, a sitemap, or the person.

## Spike

A script run with the repo's Electron (41.0.2, macOS) against two real dev servers: hidden `BrowserWindow`s (`show: false`, throttling off) sharing one session, `loadURL`, 400 ms to settle, `capturePage`, a 480 px JPEG at quality 70. This is not the `<webview>` tag and was not run on Windows or Linux, where hidden captures have failed before (electron#31992).

| | Astro landing | Next.js 16 app with a login |
|---|---|---|
| Routes from page files | 0 (all 6 page files are dynamic) | 61 without params (the ones with params were skipped) |
| Routes from following links | 28 from `/` | not measured (the file list already filled the spike's cap of 60) |
| Reached without a login | 28 | 14 (47 went to the login page) |
| Load, first visit (median / max) | 26 ms / 352 ms | 1.1 s / 8.7 s (compiled on demand) |
| Load, second visit (median / max) | 34 ms / 127 ms | 215 ms / 796 ms |
| Capture (median) | 15 ms | 13 ms |
| Thumbnail (median) | 12 KB | 4 KB (mostly the login page) |
| Whole pass, second visit | 4.6 s, 3 windows | 14.4 s, 3 windows |

- No capture came back empty while hidden. The image is at the display's scale (2560 x 1544 for a 1280 x 772 view).
- Resizing a hidden window to 375, 768 and 1440 gave captures at those widths.
- A live page costs 130 to 155 MB of renderer memory, one process each with no sharing: 10 live views added 1.1 to 1.3 GB. A window used for 20 to 60 captures grew to 340 to 405 MB, so capture windows should be closed after a pass.
- The thumbnail is the first screen only. Pages were 2,500 px tall at the median and 4,100 at most.

What it settles: thumbnails are cheap (a pass is seconds, a hundred of them under 1 MB), a live view per route is not (about 140 MB each), and neither way of finding routes is enough alone: files gave nothing for the Astro site and links gave little behind a login.

Not measured: the app behind the login (nobody logged in), full page thumbnails, the cost inside Exegol's own window, other frameworks.

## Design

**Where.** A section of the top bar's Project group, "Views", which replaces the tabs like the other sections and so has the full area. A view opened live shows in a side panel of the section (the Colabs layout), with "Open in a pane" for work beside an agent.

**Routes.** Three sources merged into one list, each route marked with where it came from:

1. Page files, per framework: Next.js `app/**/page.*` and `pages/**`, SvelteKit `src/routes/**/+page.svelte`, Astro `src/pages/**`. Routes with params are listed without a thumbnail until a value is known.
2. Links: each captured page reports its same-origin links, which give new routes, real values for params, and the edges of the navigation tree.
3. The person: add a route, give a param a value, exclude one. Kept per project.

**Capture.** In main: up to 3 hidden windows on the project's own partition (`persist:project-<id>`), so a login done in any browser pane of the project already counts. Only local hosts and the project's allowlist (`checkAgentUrl`). Thumbnails as JPEG under `~/.exegol/views/<project>/`, windows closed after the pass. A pass runs when the person asks; a route whose page file changed is marked stale, not recaptured by itself.

**Login.** A route that ends on another path is marked "redirected to /login" and grouped. One button opens that page live; once the person has logged in, the redirected routes are captured again.

**Safety.** Loads only, never a click or a form. Routes matching logout, sign out or delete, `/api/` and file downloads are left out by default. Page dialogs are dismissed and permissions denied, as for a page an agent drives. 200 routes at most per pass.

**Widths.** A width picker for the canvas (1280 by default), and "all widths" for one route: 1280, 768 and 375 in a row. Live at several widths only for the opened view.

## Phases

1. Routes from files and links, the thumbnail canvas, open one live, the login step. Next.js first, links for the rest.
2. Notes on a view, sent to a session through the Send to route, and agent tools (`views_list`, `views_capture`) so an agent can review every view.
3. The navigation tree: edges from links, grouped by layout and by public or protected.
4. Widths: the picker, the row of three, a live view at several widths with synced scroll.

## Decisions (2026-11-18)

- A pane type of its own (`views`), not a section: alone in a tab it has the whole area.
- Full page captures, cut at 1,920 px of a 1920 x 1080 screen (the most used desktop size); the limit is one constant.
- A pass runs when the pane opens and the views paint as they load. Captures are temporary files: deleted on a new pass, by hand and when Exegol quits; they can be copied as an image or as a file path for an agent.
- robots.txt and the sitemap are read from the local server and shown as badges per view.
- The tree is laid out by path. The real links are drawn only for the selected view, dashed when they open a new tab, with the outside sites listed.
- The server is one already running for the project. Exegol starts none.

Phase 1 was built with these (see `TASK_COMPLETED/2611.md`). The "Design" section above is the first proposal and differs where these say so.
