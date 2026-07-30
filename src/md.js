export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ponytail: escape-first regex renderer — headings, emphasis, code, links, lists, tasks, quotes, rules.
// No tables, no nested lists, no reference links. Swap in a real parser if those turn up.
// Escaping happens before any markup is added, so untrusted issue/comment bodies can't inject HTML.
export function md(src) {
  const inline = (s) =>
    s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\W)\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/(^|\W)_([^_\s][^_]*)_/g, "$1<em>$2</em>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>")
      // only http(s) — keeps javascript: and data: URLs out of href
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, `<a href="$2" target="_blank">$1</a>`)
      .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, `$1<a href="$2" target="_blank">$2</a>`);

  const out = [];
  let list = null;
  let fence = false;
  let buf = [];
  const closeList = () => list && (out.push(`</${list}>`), (list = null));
  const openList = (kind, cls = "") => {
    if (list !== kind) {
      closeList();
      out.push(`<${kind}${cls}>`);
      list = kind;
    }
  };

  for (const line of esc(src || "").split("\n")) {
    if (/^\s*```/.test(line)) {
      if (fence) out.push(`<pre><code>${buf.join("\n")}</code></pre>`), (buf = []);
      else closeList();
      fence = !fence;
      continue;
    }
    if (fence) {
      buf.push(line);
      continue;
    }
    let m;
    if (!line.trim()) closeList();
    else if ((m = line.match(/^(#{1,6})\s+(.*)/))) {
      closeList();
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      closeList();
      out.push("<hr>");
    } else if ((m = line.match(/^\s*&gt;\s?(.*)/))) {
      closeList();
      out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else if ((m = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)/))) {
      openList("ul", ' class="tasks"');
      out.push(`<li><input type="checkbox" disabled ${m[1] === " " ? "" : "checked"}>${inline(m[2])}</li>`);
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)/))) {
      openList("ul");
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      openList("ol");
      out.push(`<li>${inline(m[1])}</li>`);
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (buf.length) out.push(`<pre><code>${buf.join("\n")}</code></pre>`); // unterminated fence
  closeList();
  return out.join("");
}
