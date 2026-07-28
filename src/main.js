const { invoke } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;
const notif = window.__TAURI__.notification;

const $ = (s) => document.querySelector(s);
const git = (args) => invoke("git", { path: repo, args });
const gh = (args) => invoke("gh", { path: repo, args });
const ghGlobal = (args) => invoke("gh", { path: ".", args });
const esc = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- state ----------
let repo = null; // absolute path of the connected repo
let ghOk = false; // gh CLI installed + authed
let ghRemote = false; // connected repo has a github.com remote

// ---------- storage: tauri store plugin, one JSON file in app data ----------
let store;
let db = { reposDirs: [], lastRepo: null, tickets: {} };
const persist = () => store.set("db", db);
const tickets = () => (repo ? (db.tickets[repo] ||= []) : []);
const saveTickets = () => {
  persist();
  renderDash();
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

function renderSidebar() {
  const el = $("#repo-groups");
  if (!db.reposDirs.length) {
    el.innerHTML = `<div class="empty">Click + to add a folder<br>containing your repos</div>`;
    return;
  }
  el.innerHTML = db.reposDirs
    .map(
      (d) => `
      <div class="repo-group">
        <div class="group-head" title="${esc(d)}">
          <span>${esc(d.split("/").pop())}</span>
          <button data-remove="${esc(d)}" title="Remove folder">×</button>
        </div>
        ${
          (scans[d] || [])
            .map(
              (p) =>
                `<div class="repo-item ${p === repo ? "active" : ""}" data-path="${esc(p)}" title="${esc(p)}"><i class="dot" style="background:${repoColor(p)}"></i>${esc(p.split("/").pop())}</div>`
            )
            .join("") || `<div class="empty">no repos found</div>`
        }
      </div>`
    )
    .join("");
}

$("#repo-groups").onclick = (e) => {
  const rm = e.target.closest("[data-remove]");
  if (rm) {
    db.reposDirs = db.reposDirs.filter((d) => d !== rm.dataset.remove);
    persist();
    renderSidebar();
    return;
  }
  const item = e.target.closest(".repo-item");
  if (item && item.dataset.path !== repo) connect(item.dataset.path);
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
async function viewComments(kind, number) {
  try {
    toast("Loading comments…");
    const out = await gh([kind, "view", String(number), "--json", "title,body,author,comments"]);
    const d = JSON.parse(out);
    $("#comments-title").textContent = `#${number} ${d.title}`;
    const post = (author, body) =>
      `<div class="comment"><div class="comment-author">${esc(author || "?")}</div><div class="comment-body">${esc(body || "(no text)")}</div></div>`;
    $("#comments-list").innerHTML =
      post(d.author?.login, d.body) +
      (d.comments || []).map((c) => post(c.author?.login, c.body)).join("") +
      ((d.comments || []).length ? "" : `<div class="empty">No comments yet</div>`);
    $("#toast").hidden = true;
    $("#comments-dialog").showModal();
  } catch (e) {
    toast(String(e), true);
  }
}

// ---------- calendar: deadlines across all repos, colored per repo ----------
let calDate = new Date();

function renderCal() {
  const y = calDate.getFullYear();
  const m = calDate.getMonth();
  $("#cal-title").textContent = calDate.toLocaleString(undefined, { month: "long", year: "numeric" });
  const evs = {}; // "y-m-d" -> [{rp, t}]
  for (const [rp, ts] of Object.entries(db.tickets)) {
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
        return `<div class="cal-ev" data-repo="${esc(rp)}" style="--c:${repoColor(rp)}" title="${esc(rp.split("/").pop())} — ${esc(t.title)} (due ${new Date(t.deadline).toLocaleString()})">${esc(t.title)}</div>`;
      })
      .join("");
    html += `<div class="cal-day ${d.getMonth() !== m ? "other" : ""} ${d.toDateString() === today ? "today" : ""}">
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
$("#cal-grid").onclick = (e) => {
  const ev = e.target.closest(".cal-ev");
  if (ev && ev.dataset.repo !== repo) connect(ev.dataset.repo);
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

function ticketRow(t, done) {
  const d = deadlineInfo(t);
  return `<div class="ticket-row" data-id="${t.id}">
    <div class="t-main">
      <div class="title">${t.issue ? `<span class="issue">#${t.issue}</span> ` : ""}${esc(t.title)}</div>
      ${t.description ? `<div class="desc">${esc(t.description)}</div>` : ""}
    </div>
    <span class="deadline ${d.cls}">${d.label}</span>
    <span class="actions">
      <button data-edit>Edit</button>
      ${done ? `<button data-reopen>Reopen</button>` : `<button data-done>Done</button>`}
      ${t.issue ? `<button data-comments>Comments</button>` : ""}
      <button data-del>Delete</button>
    </span>
  </div>`;
}

function renderDash() {
  const all = tickets();
  const open = all.filter((t) => t.status !== "done");
  const done = all.filter((t) => t.status === "done");
  const dueIn = (t) => (t.deadline ? new Date(t.deadline) - Date.now() : Infinity);
  $("#stat-open").textContent = open.length;
  $("#stat-due").textContent = open.filter((t) => dueIn(t) >= 0 && dueIn(t) < 24 * 3600 * 1000).length;
  $("#stat-overdue").textContent = open.filter((t) => dueIn(t) < 0).length;
  $("#upcoming").innerHTML =
    [...open].sort((a, b) => dueIn(a) - dueIn(b)).map((t) => ticketRow(t, false)).join("") ||
    `<div class="empty">No open tickets</div>`;
  $("#done-list").innerHTML = done.map((t) => ticketRow(t, true)).join("") || `<div class="empty">Nothing completed yet</div>`;
  $("#completed").querySelector("summary").textContent = `Completed (${done.length})`;
}

async function setStatus(t, status) {
  const was = t.status;
  t.status = status;
  saveTickets();
  if (t.issue && ghOk && ghRemote) {
    try {
      if (status === "done" && was !== "done") await gh(["issue", "close", String(t.issue)]);
      else if (was === "done" && status !== "done") await gh(["issue", "reopen", String(t.issue)]);
    } catch (e) {
      toast("GitHub: " + e, true);
    }
  }
}

$("#tab-dash").addEventListener("click", (e) => {
  const row = e.target.closest(".ticket-row");
  if (!row) return;
  const all = tickets();
  const t = all.find((x) => x.id === row.dataset.id);
  if (!t) return;
  const ds = e.target.dataset;
  if ("edit" in ds) openTicketDialog(t);
  else if ("done" in ds) setStatus(t, "done");
  else if ("reopen" in ds) setStatus(t, "open");
  else if ("comments" in ds) viewComments("issue", t.issue);
  else if ("del" in ds) {
    all.splice(all.indexOf(t), 1);
    saveTickets();
  }
});

let editingId = null;
function openTicketDialog(t) {
  editingId = t?.id || null;
  const f = $("#ticket-form");
  f.reset();
  $("#ticket-dialog-title").textContent = t ? "Edit ticket" : "New ticket";
  if (t) {
    f.elements.title.value = t.title;
    f.elements.description.value = t.description || "";
    f.elements.deadline.value = t.deadline || "";
  }
  $("#ticket-dialog").showModal();
}
$("#new-ticket-btn").onclick = () => {
  if (!repo) return toast("Connect a repository first", true);
  openTicketDialog();
};

$("#ticket-dialog").onclose = () => {
  if ($("#ticket-dialog").returnValue !== "ok") return;
  const f = new FormData($("#ticket-form"));
  if (editingId) {
    const t = tickets().find((x) => x.id === editingId);
    if (!t) return;
    t.title = f.get("title");
    t.description = f.get("description");
    if (t.deadline !== (f.get("deadline") || null)) t.notifiedAt = 0; // re-arm reminder on deadline change
    t.deadline = f.get("deadline") || null;
    saveTickets();
  } else {
    const t = {
      id: crypto.randomUUID(),
      title: f.get("title"),
      description: f.get("description"),
      deadline: f.get("deadline") || null,
      status: "open",
      notifiedAt: 0,
    };
    tickets().push(t);
    saveTickets();
    createIssue(t);
  }
  checkDeadlines();
};

async function createIssue(t) {
  if (!ghOk || !ghRemote) return;
  try {
    let body = t.description || "";
    if (t.deadline) body += `\n\nDeadline: ${t.deadline}`;
    const out = await gh(["issue", "create", "--title", t.title, "--body", body]);
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
    const out = await gh(["issue", "list", "--state", "open", "--json", "number,title,body"]);
    const known = new Set(tickets().map((t) => t.issue).filter(Boolean));
    let added = 0;
    for (const i of JSON.parse(out || "[]")) {
      if (known.has(i.number)) continue;
      const dl = (i.body || "").match(/Deadline: (\S+)/);
      tickets().push({
        id: crypto.randomUUID(),
        title: i.title,
        description: (i.body || "").replace(/\n*Deadline: \S+/, "").trim(),
        deadline: dl ? dl[1] : null,
        status: "open",
        issue: i.number,
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

// ---------- deadline reminders ----------
async function checkDeadlines() {
  if (!repo) return;
  const due = tickets().filter(
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
  await initStore();
  renderSidebar();
  rescan();
  await detectGh();
  if (db.lastRepo) await connect(db.lastRepo);
  renderDash();
})();
