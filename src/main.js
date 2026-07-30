import { esc, md } from "./md.js";
import { icon } from "./icons.js";

const { invoke } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;
const notif = window.__TAURI__.notification;

const $ = (s) => document.querySelector(s);
const git = (args) => invoke("git", { path: repo, args });
const gh = (args) => invoke("gh", { path: repo, args });
const ghGlobal = (args) => invoke("gh", { path: ".", args });


// ---------- state ----------
let repo = null; // absolute path of the connected repo
let ghOk = false; // gh CLI installed + authed
let ghRemote = false; // connected repo has a github.com remote
let allView = false; // dashboard shows tickets from every repo, not just the connected one
let ghUser = null; // active gh account login, used for the "assigned to me" filter

// ---------- storage: tauri store plugin, one JSON file in app data ----------
let store;
let db = { reposDirs: [], lastRepo: null, tickets: {} };
const persist = () => store.set("db", db);
const tickets = () => (repo ? (db.tickets[repo] ||= []) : []);
const saveTickets = () => {
  persist();
  renderDash();
  renderSidebar(); // ticket counts live in the sidebar
  if (!$("#tab-cal").hidden) renderCal();
};

async function initStore() {
  store = await window.__TAURI__.store.load("data.json", { autoSave: true });
  const saved = await store.get("db");
  if (saved) db = saved;
  db.reposDirs ||= [];
  // reset colors assigned by the old 8-color palette (they wrapped and repeated)
  if (Object.values(db.repoColors || {}).some((c) => c.startsWith("#"))) db.repoColors = {};
}

// ---------- toast ----------
let toastTimer;
function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = isError ? "error" : "";
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

// ---------- repo ----------
async function connect(path) {
  try {
    await invoke("git", { path, args: ["rev-parse", "--is-inside-work-tree"] });
  } catch {
    toast("Not a git repository: " + path, true);
    return;
  }
  repo = path;
  db.lastRepo = path;
  persist();
  ghRemote = false;
  try {
    ghRemote = (await git(["remote", "get-url", "origin"])).includes("github.com");
  } catch {}
  $("#sync-btn").hidden = !(ghOk && ghRemote);
  $("#repo-name").textContent = path.split("/").pop();
  $("#repo-name").classList.remove("muted");
  for (const id of ["fetch-btn", "pull-btn", "push-btn"]) $("#" + id).hidden = false;
  renderSidebar();
  await refreshGitViews();
  renderDash();
  renderNotes();
  checkDeadlines();
}

async function refreshGitViews() {
  await refreshBranchBadge();
  renderChanges();
  renderHistory();
  try {
    $("#stat-commits").textContent = (await git(["rev-list", "--count", "HEAD"])).trim();
  } catch {
    $("#stat-commits").textContent = "0"; // empty repo, no HEAD yet
  }
}

async function refreshBranchBadge() {
  try {
    const sb = (await git(["status", "-sb"])).split("\n")[0]; // "## main...origin/main [ahead 1, behind 2]"
    const branch = sb.match(/## (\S+?)(?:\.\.\.|$)/)?.[1] || "?";
    const ahead = sb.match(/ahead (\d+)/);
    const behind = sb.match(/behind (\d+)/);
    const b = $("#repo-branch");
    b.textContent = branch + (ahead ? ` ↑${ahead[1]}` : "") + (behind ? ` ↓${behind[1]}` : "");
    b.hidden = false;
  } catch (e) {
    toast(String(e), true);
  }
}

// ---------- repo colors: golden-angle hue spacing, unique per repo ----------
function repoColor(p) {
  db.repoColors ||= {};
  if (!db.repoColors[p]) {
    const n = Object.keys(db.repoColors).length;
    db.repoColors[p] = `hsl(${Math.round(n * 137.508) % 360} 45% 62%)`;
    persist();
  }
  return db.repoColors[p];
}

// ---------- sidebar: repos folders scanned for .git ----------
let scans = {}; // reposDir -> [repo paths]

async function rescan() {
  const next = {};
  for (const d of db.reposDirs) {
    try {
      next[d] = await invoke("scan_repos", { path: d });
    } catch {
      next[d] = [];
    }
  }
  scans = next;
  renderSidebar();
}

// removed repos: kept as a list rather than deleted, so a rescan doesn't bring them back
// and their tickets survive if the repo is restored
const isHidden = (p) => (db.hidden ||= []).includes(p);

// open-ticket count for a repo, tinted by the worst deadline in it: red overdue > amber due-in-24h > plain
function countBadge(ts) {
  const open = ts.filter((t) => t.status !== "done");
  if (!open.length) return "";
  const dueIn = (t) => (t.deadline ? new Date(t.deadline) - Date.now() : Infinity);
  const overdue = open.filter((t) => dueIn(t) < 0).length;
  const soon = open.filter((t) => dueIn(t) >= 0 && dueIn(t) < 24 * 3600 * 1000).length;
  const cls = overdue ? "overdue" : soon ? "soon" : "";
  const title = `${open.length} open` + (overdue ? `, ${overdue} overdue` : "") + (soon ? `, ${soon} due in 24h` : "");
  return `<span class="count ${cls}" title="${title}">${open.length}</span>`;
}

function renderSidebar() {
  const el = $("#repo-groups");
  if (!db.reposDirs.length) {
    el.innerHTML = `<div class="empty">Click + to add a folder<br>containing your repos</div>`;
    return;
  }
  const visible = Object.fromEntries(db.reposDirs.map((d) => [d, (scans[d] || []).filter((p) => !isHidden(p))]));
  el.innerHTML =
    `<div class="repo-item ${allView ? "active" : ""}" data-all>
       <i class="dot all-dot"></i><span class="name">All repositories</span>${countBadge(
         Object.entries(db.tickets)
           .filter(([rp]) => !isHidden(rp))
           .flatMap(([, ts]) => ts)
       )}
     </div>` +
    db.reposDirs
      .map(
        (d) => `
      <details class="repo-group" ${db.collapsed?.includes(d) ? "" : "open"}>
        <summary class="group-head" data-dir="${esc(d)}" title="${esc(d)}">
          <span class="name">${esc(d.split("/").pop())}</span>
          <button data-remove="${esc(d)}" title="Remove folder" aria-label="Remove folder">×</button>
        </summary>
        ${
          visible[d]
            .map(
              (p) =>
                `<div class="repo-item ${p === repo && !allView ? "active" : ""}" data-path="${esc(p)}" title="${esc(p)}">
                   <i class="dot" style="background:${repoColor(p)}"></i><span class="name">${esc(p.split("/").pop())}</span>${countBadge(db.tickets[p] || [])}
                   <button data-hide="${esc(p)}" title="Remove this repository from the list" aria-label="Remove repository">×</button>
                 </div>`
            )
            .join("") || `<div class="empty">no repos found</div>`
        }
      </details>`
      )
      .join("") +
    (db.hidden?.length
      ? `<div class="side-foot">${db.hidden.length} removed <button data-unhide>Restore</button></div>`
      : "");
}

$("#repo-groups").onclick = (e) => {
  const rm = e.target.closest("[data-remove]");
  if (rm) {
    e.preventDefault(); // don't also collapse the group we just clicked inside
    db.reposDirs = db.reposDirs.filter((d) => d !== rm.dataset.remove);
    persist();
    renderSidebar();
    return;
  }
  const hide = e.target.closest("[data-hide]");
  if (hide) {
    const p = hide.dataset.hide;
    (db.hidden ||= []).push(p);
    persist();
    renderSidebar();
    renderDash();
    if (!$("#tab-cal").hidden) renderCal();
    toast(`Removed ${p.split("/").pop()} — Restore at the bottom of the sidebar`);
    return;
  }
  if (e.target.closest("[data-unhide]")) {
    db.hidden = [];
    persist();
    renderSidebar();
    renderDash();
    return;
  }
  // native <details> handles the visual collapse; we only remember it
  const sum = e.target.closest("[data-dir]");
  if (sum) {
    const d = sum.dataset.dir;
    db.collapsed = sum.parentElement.open ? [...(db.collapsed || []), d] : (db.collapsed || []).filter((x) => x !== d);
    persist();
    return;
  }
  const item = e.target.closest(".repo-item");
  if (!item) return;
  allView = db.allView = "all" in item.dataset;
  persist();
  renderSidebar();
  if (!allView && item.dataset.path !== repo) connect(item.dataset.path);
  else renderDash();
};

$("#add-dir-btn").onclick = async () => {
  const dir = await open({ directory: true, title: "Select a folder containing your repositories" });
  if (!dir || db.reposDirs.includes(dir)) return;
  db.reposDirs.push(dir);
  persist();
  await rescan();
};
$("#rescan-btn").onclick = rescan;

async function gitAction(args, label) {
  try {
    toast(label + "…");
    await git(args);
    toast(label + " done");
    refreshGitViews();
  } catch (e) {
    toast(String(e), true);
  }
}
$("#fetch-btn").onclick = () => gitAction(["fetch", "--all"], "Fetch");
$("#pull-btn").onclick = () => gitAction(["pull"], "Pull");
$("#push-btn").onclick = () => gitAction(["push"], "Push");

// auto-fetch every 5 minutes, silent
setInterval(async () => {
  if (!repo) return;
  try {
    await git(["fetch", "--all", "--quiet"]);
    refreshBranchBadge();
  } catch {}
}, 5 * 60 * 1000);

// ---------- github accounts ----------
function parseAccounts(txt) {
  const accs = [];
  let cur;
  for (const line of txt.split("\n")) {
    const m = line.match(/account (\S+)/);
    if (m) accs.push((cur = { name: m[1], active: false }));
    if (cur && /Active account: true/.test(line)) cur.active = true;
  }
  return accs;
}

async function detectGh() {
  let accs = [];
  try {
    accs = parseAccounts(await ghGlobal(["auth", "status"]));
    ghOk = true;
  } catch {
    ghOk = false;
  }
  ghUser = accs.find((a) => a.active)?.name || null;
  const sel = $("#account-select");
  sel.hidden = !accs.length;
  sel.innerHTML =
    accs.map((a) => `<option value="${esc(a.name)}" ${a.active ? "selected" : ""}>@${esc(a.name)}</option>`).join("") +
    `<option value="__add">+ Add account…</option>`;
  if (repo) $("#sync-btn").hidden = !(ghOk && ghRemote);
}

$("#account-select").onchange = async (e) => {
  if (e.target.value === "__add") {
    toast("Run `gh auth login` in a terminal, then reopen this menu");
    detectGh();
    return;
  }
  try {
    await ghGlobal(["auth", "switch", "--user", e.target.value]);
    toast("Switched to @" + e.target.value);
  } catch (err) {
    toast(String(err), true);
  }
  detectGh();
};

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
    document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.id !== "tab-" + t.dataset.tab));
    if (t.dataset.tab === "cal") renderCal();
    if (t.dataset.tab === "changes") renderChanges();
    if (t.dataset.tab === "history") renderHistory();
    if (t.dataset.tab === "prs") renderPRs();
    if (t.dataset.tab === "notes") renderNotes();
  };
});

// ---------- changes ----------
async function renderChanges() {
  if (!repo) return;
  const ul = $("#changes-list");
  try {
    const out = await git(["status", "--porcelain"]);
    const lines = out.split("\n").filter(Boolean);
    ul.innerHTML = lines.length
      ? lines
          .map((l) => `<li><span class="xy">${esc(l.slice(0, 2))}</span><span>${esc(l.slice(3))}</span></li>`)
          .join("")
      : `<li class="empty">Working tree clean</li>`;
  } catch (e) {
    ul.innerHTML = `<li class="empty">${esc(String(e))}</li>`;
  }
}

$("#commit-btn").onclick = async () => {
  const msg = $("#commit-msg").value.trim();
  if (!msg) return toast("Commit message required", true);
  try {
    await git(["add", "-A"]);
    await git(["commit", "-m", msg]);
    $("#commit-msg").value = "";
    toast("Committed");
    refreshGitViews();
  } catch (e) {
    toast(String(e), true);
  }
};

// ---------- history ----------
async function renderHistory() {
  if (!repo) return;
  const ul = $("#history-list");
  try {
    const out = await git(["log", "--pretty=format:%h\x1f%s\x1f%an\x1f%ar", "-30"]);
    ul.innerHTML = out
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [h, s, an, ar] = l.split("\x1f");
        return `<li><span class="hash">${esc(h)}</span><span>${esc(s)}</span><span class="meta">${esc(an)} · ${esc(ar)}</span></li>`;
      })
      .join("");
  } catch (e) {
    ul.innerHTML = `<li class="empty">${esc(String(e))}</li>`;
  }
}

// ---------- pull requests ----------
async function renderPRs() {
  const ul = $("#pr-list");
  if (!repo || !ghOk || !ghRemote) {
    ul.innerHTML = `<li class="empty">Connect a GitHub repository (with gh CLI logged in) to see pull requests</li>`;
    return;
  }
  try {
    const out = await gh(["pr", "list", "--json", "number,title,author"]);
    const prs = JSON.parse(out || "[]");
    ul.innerHTML = prs.length
      ? prs
          .map(
            (p) =>
              `<li class="clickable" data-pr="${p.number}"><span class="hash">#${p.number}</span><span>${esc(p.title)}</span><span class="meta">${esc(p.author?.login || "")}</span></li>`
          )
          .join("")
      : `<li class="empty">No open pull requests</li>`;
  } catch (e) {
    ul.innerHTML = `<li class="empty">${esc(String(e))}</li>`;
  }
}
$("#pr-list").onclick = (e) => {
  const li = e.target.closest("li[data-pr]");
  if (li) viewComments("pr", li.dataset.pr);
};

// ---------- comments viewer (issues + PRs) ----------
let commentTarget = null; // {kind, number, path} of the thread on screen

async function viewComments(kind, number, path = repo, keepDraft = false) {
  try {
    toast("Loading comments…");
    const out = await invoke("gh", { path, args: [kind, "view", String(number), "--json", "title,body,author,comments"] });
    const d = JSON.parse(out);
    commentTarget = { kind, number, path };
    if (!keepDraft) boxIn($("#comment-editor")).value = "";
    setPreview($("#comment-editor"), false);
    $("#comments-title").textContent = `#${number} ${d.title}`;
    const post = (author, body) =>
      `<div class="comment"><div class="comment-author">${esc(author || "?")}</div><div class="comment-body md">${md(body || "_(no text)_")}</div></div>`;
    $("#comments-list").innerHTML =
      post(d.author?.login, d.body) +
      (d.comments || []).map((c) => post(c.author?.login, c.body)).join("") +
      ((d.comments || []).length ? "" : `<div class="empty">No comments yet</div>`);
    $("#toast").hidden = true;
    if (!$("#comments-dialog").open) $("#comments-dialog").showModal();
    $("#comments-list").scrollTop = $("#comments-list").scrollHeight;
  } catch (e) {
    toast(String(e), true);
  }
}

$("#comment-send").onclick = async () => {
  const box = boxIn($("#comment-editor"));
  const body = box.value.trim();
  if (!body) return toast("Write something first", true);
  if (!commentTarget) return;
  const { kind, number, path } = commentTarget;
  const btn = $("#comment-send");
  btn.disabled = true;
  try {
    await invoke("gh", { path, args: [kind, "comment", String(number), "--body", body] });
    box.value = "";
    await viewComments(kind, number, path); // reload so the new comment shows with its real author
    toast("Comment posted");
  } catch (e) {
    toast("GitHub: " + e, true); // draft stays in the box so nothing is lost
  } finally {
    btn.disabled = false;
  }
};

// ---------- calendar: deadlines across all repos, colored per repo ----------
let calDate = new Date();

function renderCal() {
  const y = calDate.getFullYear();
  const m = calDate.getMonth();
  $("#cal-title").textContent = calDate.toLocaleString(undefined, { month: "long", year: "numeric" });
  const evs = {}; // "y-m-d" -> [{rp, t}]
  for (const [rp, ts] of Object.entries(db.tickets)) {
    if (isHidden(rp)) continue;
    for (const t of ts) {
      if (!t.deadline || t.status === "done") continue;
      const d = new Date(t.deadline);
      (evs[`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`] ||= []).push({ rp, t });
    }
  }
  const start = new Date(y, m, 1 - new Date(y, m, 1).getDay()); // back to Sunday
  const today = new Date().toDateString();
  const legendRepos = new Set();
  let html = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="cal-dow">${d}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const items = (evs[`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`] || [])
      .map(({ rp, t }) => {
        legendRepos.add(rp);
        return `<div class="cal-ev" data-repo="${esc(rp)}" data-id="${t.id}" style="--c:${repoColor(rp)}" title="${esc(rp.split("/").pop())} — ${esc(t.title)} (due ${new Date(t.deadline).toLocaleString()})">${esc(t.title)}</div>`;
      })
      .join("");
    html += `<div class="cal-day ${d.getMonth() !== m ? "other" : ""} ${d.toDateString() === today ? "today" : ""}"
      data-date="${d.toLocaleDateString("sv")}" title="Click to add a ticket on this day">
      <span class="cal-num">${d.getDate()}</span>${items}</div>`;
  }
  $("#cal-grid").innerHTML = html;
  $("#cal-legend").innerHTML = [...legendRepos]
    .map((rp) => `<span class="chip"><i style="background:${repoColor(rp)}"></i>${esc(rp.split("/").pop())}</span>`)
    .join("");
}
$("#cal-prev").onclick = () => {
  calDate.setMonth(calDate.getMonth() - 1);
  renderCal();
};
$("#cal-next").onclick = () => {
  calDate.setMonth(calDate.getMonth() + 1);
  renderCal();
};
$("#cal-today").onclick = () => {
  calDate = new Date();
  renderCal();
};
$("#cal-grid").onclick = async (e) => {
  const ev = e.target.closest(".cal-ev");
  if (ev) {
    const t = findTicket(ev.dataset.id)?.t;
    if (t) openTicketDialog(t);
    return;
  }
  const day = e.target.closest(".cal-day");
  if (!day) return;
  if (!knownRepos().length) return toast("Add a repos folder first", true);
  openTicketDialog(null, day.dataset.date);
};

// ---------- tickets ----------
function deadlineInfo(t) {
  if (!t.deadline) return { cls: "", label: "No deadline" };
  const ms = new Date(t.deadline) - Date.now();
  const label = new Date(t.deadline).toLocaleString();
  if (ms < 0) return { cls: "overdue", label: "Overdue · " + label };
  if (ms < 24 * 3600 * 1000) return { cls: "soon", label: "Due soon · " + label };
  return { cls: "", label: "Due " + label };
}

function ticketRow(t, done, rp) {
  const d = deadlineInfo(t);
  const badge = rp
    ? `<span class="repo-tag" data-tip="${esc(rp)}"><i class="dot" style="background:${repoColor(rp)}"></i>${esc(rp.split("/").pop())}</span> `
    : "";
  const who = (t.assignees || []).length
    ? `<span class="assignee" data-tip="Assigned to ${esc(t.assignees.join(", "))}">@${esc(t.assignees[0])}</span> `
    : "";
  const act = (attr, name, tip) => `<button ${attr} class="icon-btn" data-tip="${tip}" aria-label="${tip}">${icon[name]}</button>`;
  return `<div class="ticket-row" data-id="${t.id}">
    <div class="t-main">
      <div class="title">${badge}${who}${t.issue ? `<span class="issue">#${t.issue}</span> ` : ""}${esc(t.title)}</div>
      ${t.description ? `<div class="desc">${esc(plain(t.description))}</div>` : ""}
    </div>
    <span class="deadline ${d.cls}">${d.label}</span>
    <span class="actions">
      ${act("data-edit", "edit", "Edit")}
      ${done ? act("data-reopen", "reopen", "Reopen") : act("data-done", "check", "Mark done")}
      ${t.issue ? act("data-comments", "comment", "View comments") : ""}
      ${act("data-del", "trash", "Delete")}
    </span>
  </div>`;
}

// one-line preview of a markdown body — strip the syntax so rows don't show raw ## and ```
const plain = (s) =>
  s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/gm, "• ")
    .replace(/[*_`~>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

// every ticket in view as {rp, t} — all repos in "All repositories" mode, else just the connected one
const viewTickets = () =>
  allView
    ? Object.entries(db.tickets)
        .filter(([rp]) => !isHidden(rp))
        .flatMap(([rp, ts]) => ts.map((t) => ({ rp, t })))
    : tickets().map((t) => ({ rp: repo, t }));

// a ticket id is unique across repos, so the owning repo can always be recovered from it
function findTicket(id) {
  for (const [rp, ts] of Object.entries(db.tickets)) {
    const t = ts.find((x) => x.id === id);
    if (t) return { rp, t, list: ts };
  }
}

function renderDash() {
  const all = viewTickets();
  const open = all.filter(({ t }) => t.status !== "done");
  const done = all.filter(({ t }) => t.status === "done");
  const dueIn = ({ t }) => (t.deadline ? new Date(t.deadline) - Date.now() : Infinity);
  const row = ({ rp, t }, isDone) => ticketRow(t, isDone, allView ? rp : null);
  // stats count everything open, not the filtered subset — they're the overview, the list is the filter
  $("#stat-open").textContent = open.length;
  $("#stat-due").textContent = open.filter((x) => dueIn(x) >= 0 && dueIn(x) < 24 * 3600 * 1000).length;
  $("#stat-overdue").textContent = open.filter((x) => dueIn(x) < 0).length;

  syncFilterOptions(all);
  const q = $("#filter-text").value.trim().toLowerCase();
  const status = $("#filter-status").value;
  const onlyRepo = $("#filter-repo").value;
  const who = $("#filter-assignee").value;
  const from = $("#filter-from").value;
  const to = $("#filter-to").value;

  const textMatch = ({ rp, t }) =>
    !q || [t.title, t.description, rp, t.issue && "#" + t.issue].some((s) => s?.toLowerCase().includes(q));
  const statusMatch = (x) =>
    status === "overdue" ? dueIn(x) < 0
    : status === "soon" ? dueIn(x) >= 0 && dueIn(x) < 24 * 3600 * 1000
    : status === "dated" ? !!x.t.deadline
    : status === "none" ? !x.t.deadline
    : true;
  const repoMatch = ({ rp }) => !onlyRepo || rp === onlyRepo;
  const whoMatch = ({ t }) =>
    !who || (who === "__none" ? !t.assignees?.length : !!t.assignees?.includes(who === "__me" ? ghUser : who));
  // date-only compare against the deadline's date half; an unset bound is open-ended
  const rangeMatch = ({ t }) => {
    if (!from && !to) return true;
    const d = t.deadline?.slice(0, 10);
    return !!d && (!from || d >= from) && (!to || d <= to);
  };
  const keep = (x) => textMatch(x) && statusMatch(x) && repoMatch(x) && whoMatch(x) && rangeMatch(x);

  const shown = open.filter(keep);
  const shownDone = done.filter((x) => textMatch(x) && repoMatch(x) && whoMatch(x)); // deadline filters mean nothing here
  const filtering = !!(q || status || onlyRepo || who || from || to);
  $("#filter-clear").hidden = !filtering;
  $("#filter-count").textContent = filtering ? `${shown.length} of ${open.length} open` : "";

  $("#upcoming").innerHTML =
    [...shown].sort((a, b) => dueIn(a) - dueIn(b)).map((x) => row(x, false)).join("") ||
    `<div class="empty">${open.length ? "No tickets match these filters" : "No open tickets"}</div>`;
  $("#done-list").innerHTML =
    shownDone.map((x) => row(x, true)).join("") || `<div class="empty">Nothing completed yet</div>`;
  $("#completed").querySelector("summary").textContent = `Completed (${shownDone.length})`;
}

// repo + assignee dropdowns list only what's actually in view, keeping the current pick if it survives
function syncFilterOptions(rows) {
  const fill = (sel, opts) => {
    const cur = sel.value;
    const html = opts.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join("");
    if (sel.innerHTML !== html) {
      sel.innerHTML = html;
      sel.value = opts.some(([v]) => v === cur) ? cur : "";
    }
  };
  const repos = [...new Set(rows.map((x) => x.rp))].sort();
  fill($("#filter-repo"), [["", "All repositories"], ...repos.map((p) => [p, p.split("/").pop()])]);

  const people = [...new Set(rows.flatMap((x) => x.t.assignees || []))].sort();
  fill($("#filter-assignee"), [
    ["", "Anyone"],
    ...(ghUser ? [["__me", `Me (@${ghUser})`]] : []),
    ...people.filter((p) => p !== ghUser).map((p) => [p, "@" + p]),
    ["__none", "Unassigned"],
  ]);
}

for (const id of ["#filter-text", "#filter-status", "#filter-repo", "#filter-assignee", "#filter-from", "#filter-to"])
  $(id).addEventListener("input", renderDash);
$("#filter-clear").onclick = () => {
  for (const id of ["#filter-text", "#filter-status", "#filter-repo", "#filter-assignee", "#filter-from", "#filter-to"])
    $(id).value = "";
  renderDash();
};

async function setStatus(t, status, rp) {
  const was = t.status;
  t.status = status;
  saveTickets();
  if (t.issue && ghOk) {
    try {
      if (status === "done" && was !== "done") await invoke("gh", { path: rp, args: ["issue", "close", String(t.issue)] });
      else if (was === "done" && status !== "done")
        await invoke("gh", { path: rp, args: ["issue", "reopen", String(t.issue)] });
    } catch (e) {
      toast("GitHub: " + e, true);
    }
  }
}

$("#tab-dash").addEventListener("click", (e) => {
  const row = e.target.closest(".ticket-row");
  if (!row) return;
  const found = findTicket(row.dataset.id);
  if (!found) return;
  const { rp, t, list } = found;
  const ds = e.target.closest("button")?.dataset; // clicks land on the <svg> inside the button
  if (!ds) return;
  if ("edit" in ds) openTicketDialog(t);
  else if ("done" in ds) setStatus(t, "done", rp);
  else if ("reopen" in ds) setStatus(t, "open", rp);
  else if ("comments" in ds) viewComments("issue", t.issue, rp);
  else if ("del" in ds) {
    list.splice(list.indexOf(t), 1);
    saveTickets();
  }
});

const knownRepos = () =>
  [...new Set([...Object.values(scans).flat(), ...Object.keys(db.tickets), repo])]
    .filter((p) => p && !isHidden(p))
    .sort();

let editingId = null;
function openTicketDialog(t, prefillDate) {
  editingId = t?.id || null;
  const f = $("#ticket-form");
  f.reset();
  $("#ticket-dialog-title").textContent = t ? "Edit ticket" : "New ticket";
  // repo is chosen only on create — moving an existing ticket between repos isn't a thing yet
  $("#repo-field").hidden = !!t;
  f.elements.repo.innerHTML = knownRepos()
    .map((p) => `<option value="${esc(p)}" ${p === repo ? "selected" : ""}>${esc(p.split("/").pop())}</option>`)
    .join("");
  if (t) {
    f.elements.title.value = t.title;
    f.elements.description.value = t.description || "";
    const [date, time] = (t.deadline || "").split("T");
    f.elements.date.value = date || "";
    f.elements.time.value = time || "";
  } else if (prefillDate) {
    f.elements.date.value = prefillDate;
  }
  setPreview($("#ticket-editor"), false);
  $("#ticket-dialog").showModal();
  f.elements.title.focus();
}
// ---------- markdown editor ----------
// one template, mounted wherever a markdown box is needed (ticket description, issue comment)
const tool = (attrs, name, tip) =>
  `<button type="button" ${attrs} data-tip="${tip}" aria-label="${tip}">${icon[name]}</button>`;

const editorHTML = (name, placeholder) => `
  <div class="editor">
    <div class="editor-tabs">
      <button type="button" class="etab active" data-view="write">Write</button>
      <button type="button" class="etab" data-view="preview">Preview</button>
    </div>
    <div class="md-tools">
      <span class="tool-group">
        ${tool('data-prefix="## "', "heading", "Heading")}
        ${tool('data-wrap="**"', "bold", "Bold ⌘B")}
        ${tool('data-wrap="_"', "italic", "Italic ⌘I")}
      </span>
      <span class="tool-group">
        ${tool('data-prefix="&gt; "', "quote", "Quote")}
        ${tool("data-wrap=\"`\"", "code", "Code")}
        ${tool("data-link", "link", "Link ⌘K")}
      </span>
      <span class="tool-group">
        ${tool('data-prefix="- "', "listUl", "Bulleted list")}
        ${tool('data-prefix="1. "', "listOl", "Numbered list")}
        ${tool('data-prefix="- [ ] "', "task", "Task list")}
      </span>
    </div>
    <div class="editor-body">
      <textarea name="${name}" rows="10" placeholder="${esc(placeholder)}"></textarea>
      <div class="md-preview md" hidden></div>
    </div>
    <div class="editor-foot">Markdown supported</div>
  </div>`;

const boxIn = (editor) => editor.querySelector("textarea");

function wrapSel(el, before, after = before) {
  const { selectionStart: s, selectionEnd: e, value } = el;
  const sel = value.slice(s, e);
  el.setRangeText(before + sel + after, s, e, "end");
  el.setSelectionRange(s + before.length, s + before.length + sel.length); // keep the text selected, not the markers
  el.focus();
}

function prefixLines(el, prefix) {
  const { selectionStart: s, selectionEnd: e, value } = el;
  const from = value.lastIndexOf("\n", s - 1) + 1;
  const to = value.indexOf("\n", e) === -1 ? value.length : value.indexOf("\n", e);
  const block = value.slice(from, to);
  // toggle: if every line already has it, strip it
  const has = block.split("\n").every((l) => l.startsWith(prefix));
  const next = block
    .split("\n")
    .map((l) => (has ? l.slice(prefix.length) : prefix + l))
    .join("\n");
  el.setRangeText(next, from, to, "end");
  el.focus();
}

function setPreview(editor, on) {
  const box = boxIn(editor);
  const pv = editor.querySelector(".md-preview");
  pv.innerHTML = on ? md(box.value) || `<p class="muted">Nothing to preview</p>` : "";
  pv.hidden = !on;
  box.hidden = on;
  editor.querySelector(".md-tools").classList.toggle("off", on);
  for (const b of editor.querySelectorAll(".etab")) b.classList.toggle("active", (b.dataset.view === "preview") === on);
  if (!on) box.focus();
}

// delegated so every mounted editor works, including ones rendered later
document.addEventListener("click", (e) => {
  const tab = e.target.closest(".etab");
  if (tab) return setPreview(tab.closest(".editor"), tab.dataset.view === "preview");
  const b = e.target.closest(".md-tools button");
  if (!b) return;
  const box = boxIn(b.closest(".editor"));
  if ("wrap" in b.dataset) wrapSel(box, b.dataset.wrap);
  else if ("prefix" in b.dataset) prefixLines(box, b.dataset.prefix);
  else if ("link" in b.dataset) wrapSel(box, "[", "](https://)");
});

document.addEventListener("keydown", (e) => {
  if (!e.target.matches?.(".editor textarea")) return;
  const box = e.target;
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key === "b") (e.preventDefault(), wrapSel(box, "**"));
  else if (meta && e.key === "i") (e.preventDefault(), wrapSel(box, "_"));
  else if (meta && e.key === "k") (e.preventDefault(), wrapSel(box, "[", "](https://)"));
  else if (meta && e.key === "Enter" && box.closest("#comment-editor")) $("#comment-send").click(); // ⌘↵ posts
  else if (e.key === "Enter" && !meta) {
    // continue the list we're in; an empty item ends the list instead
    const el = e.target;
    const line = el.value.slice(el.value.lastIndexOf("\n", el.selectionStart - 1) + 1, el.selectionStart);
    const m = line.match(/^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)(.*)$/);
    if (!m) return;
    e.preventDefault();
    if (!m[3].trim()) return el.setRangeText("", el.selectionStart - line.length, el.selectionStart, "end");
    const marker = m[2].replace(/\[[xX]\]/, "[ ]").replace(/^(\d+)([.)])/, (_, n, d) => +n + 1 + d);
    el.setRangeText("\n" + m[1] + marker, el.selectionStart, el.selectionEnd, "end");
  }
});

$("#new-ticket-btn").onclick = () => {
  if (!knownRepos().length) return toast("Add a repos folder first", true);
  openTicketDialog();
};

// date + time inputs -> the "YYYY-MM-DDTHH:MM" string stored on the ticket; time defaults to end of day
const formDeadline = (f) => (f.get("date") ? `${f.get("date")}T${f.get("time") || "23:59"}` : null);

$("#ticket-dialog").onclose = () => {
  if ($("#ticket-dialog").returnValue !== "ok") return;
  const f = new FormData($("#ticket-form"));
  if (editingId) {
    const t = findTicket(editingId)?.t; // may live in a repo other than the connected one
    if (!t) return;
    t.title = f.get("title");
    t.description = f.get("description");
    if (t.deadline !== formDeadline(f)) t.notifiedAt = 0; // re-arm reminder on deadline change
    t.deadline = formDeadline(f);
    saveTickets();
  } else {
    const t = {
      id: crypto.randomUUID(),
      title: f.get("title"),
      description: f.get("description"),
      deadline: formDeadline(f),
      status: "open",
      notifiedAt: 0,
    };
    const target = f.get("repo") || repo;
    (db.tickets[target] ||= []).push(t);
    saveTickets();
    createIssue(t, target);
  }
  checkDeadlines();
};

async function createIssue(t, path = repo) {
  const noRemote = () => toast("Ticket saved locally (no GitHub remote / gh login)");
  if (!ghOk) return noRemote();
  try {
    const origin = await invoke("git", { path, args: ["remote", "get-url", "origin"] });
    if (!origin.includes("github.com")) return noRemote();
  } catch {
    return noRemote();
  }
  try {
    let body = t.description || "";
    if (t.deadline) body += `\n\nDeadline: ${t.deadline}`;
    const args = ["issue", "create", "--title", t.title, "--body", body, "--assignee", "@me"];
    // --assignee fails on repos you can't be assigned in (no push access); the issue itself still matters
    let assigned = true;
    const out = await invoke("gh", { path, args }).catch(() => {
      assigned = false;
      return invoke("gh", { path, args: args.slice(0, -2) });
    });
    if (assigned && ghUser) t.assignees = [ghUser];
    const m = out.trim().match(/\/issues\/(\d+)/);
    if (m) {
      t.issue = +m[1];
      saveTickets();
      toast(`Created issue #${t.issue}`);
    }
  } catch (e) {
    toast("GitHub: " + e, true);
  }
}

$("#sync-btn").onclick = async () => {
  try {
    toast("Syncing issues…");
    const out = await gh(["issue", "list", "--state", "open", "--json", "number,title,body,assignees"]);
    const byIssue = new Map(tickets().filter((t) => t.issue).map((t) => [t.issue, t]));
    let added = 0;
    for (const i of JSON.parse(out || "[]")) {
      const logins = (i.assignees || []).map((a) => a.login);
      if (byIssue.has(i.number)) {
        byIssue.get(i.number).assignees = logins; // assignees can change on GitHub, so refresh them
        continue;
      }
      const dl = (i.body || "").match(/Deadline: (\S+)/);
      tickets().push({
        id: crypto.randomUUID(),
        title: i.title,
        description: (i.body || "").replace(/\n*Deadline: \S+/, "").trim(),
        deadline: dl ? dl[1] : null,
        status: "open",
        issue: i.number,
        assignees: logins,
        notifiedAt: 0,
      });
      added++;
    }
    saveTickets();
    toast(`Imported ${added} issue(s)`);
    checkDeadlines();
  } catch (e) {
    toast("GitHub: " + e, true);
  }
};

// ---------- notes (per repo, autosaved) ----------
const notes = () => (repo ? ((db.notes ||= {})[repo] ||= []) : []);

function renderNotes() {
  const ns = notes();
  $("#notes-list").innerHTML = ns.length
    ? ns
        .map(
          (n) => `
      <div class="note" data-id="${n.id}">
        <textarea rows="6" placeholder="Write…">${esc(n.text)}</textarea>
        <div class="note-foot">
          <span class="meta">${new Date(n.updated).toLocaleString()}</span>
          <button data-del class="icon-btn" data-tip="Delete note" aria-label="Delete note">${icon.trash}</button>
        </div>
      </div>`
        )
        .join("")
    : `<div class="empty">No notes yet</div>`;
}

let noteTimer;
$("#notes-list").oninput = (e) => {
  const div = e.target.closest(".note");
  const n = notes().find((x) => x.id === div?.dataset.id);
  if (!n) return;
  n.text = e.target.value;
  n.updated = Date.now();
  div.querySelector(".meta").textContent = new Date(n.updated).toLocaleString();
  clearTimeout(noteTimer);
  noteTimer = setTimeout(persist, 500);
};
$("#notes-list").onclick = (e) => {
  if (!e.target.closest("[data-del]")) return;
  const div = e.target.closest(".note");
  const ns = notes();
  const n = ns.find((x) => x.id === div.dataset.id);
  if (n.text.trim() && !confirm("Delete this note?")) return;
  ns.splice(ns.indexOf(n), 1);
  persist();
  renderNotes();
};
$("#new-note-btn").onclick = () => {
  if (!repo) return toast("Connect a repository first", true);
  notes().unshift({ id: crypto.randomUUID(), text: "", updated: Date.now() });
  persist();
  renderNotes();
  $("#notes-list textarea")?.focus();
};

// ---------- deadline reminders ----------
async function checkDeadlines() {
  // every repo, not just the connected one — a deadline elsewhere is still a deadline
  const due = Object.values(db.tickets)
    .flat()
    .filter(
      (t) =>
        t.status !== "done" &&
        t.deadline &&
        new Date(t.deadline) - Date.now() < 24 * 3600 * 1000 &&
        Date.now() - (t.notifiedAt || 0) > 4 * 3600 * 1000 // re-remind at most every 4h
    );
  if (!due.length) return;
  let granted = await notif.isPermissionGranted();
  if (!granted) granted = (await notif.requestPermission()) === "granted";
  if (!granted) return;
  for (const t of due) {
    const overdue = new Date(t.deadline) < new Date();
    notif.sendNotification({
      title: overdue ? "Ticket overdue" : "Ticket due soon",
      body: `${t.title} — due ${new Date(t.deadline).toLocaleString()}`,
    });
    t.notifiedAt = Date.now();
  }
  saveTickets();
}
setInterval(checkDeadlines, 15 * 60 * 1000);

// ---------- boot ----------
(async () => {
  $("#ticket-editor").innerHTML = editorHTML("description", "Leave a description…");
  $("#comment-editor").innerHTML = editorHTML("comment", "Leave a comment…");
  // static buttons declare their icon in markup; filling them here keeps one icon source
  for (const el of document.querySelectorAll("[data-icon]")) el.insertAdjacentHTML("afterbegin", icon[el.dataset.icon]);
  await initStore();
  allView = !!db.allView;
  renderSidebar();
  rescan();
  await detectGh();
  if (db.lastRepo) await connect(db.lastRepo);
  renderDash();
})();
