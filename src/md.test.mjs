// run: node src/md.test.mjs
import assert from "node:assert";
import { md } from "./md.js";

const has = (src, want) => assert.ok(md(src).includes(want), `${JSON.stringify(src)} -> ${md(src)}`);

has("# Title", "<h1>Title</h1>");
has("### Deep", "<h3>Deep</h3>");
has("plain text", "<p>plain text</p>");
has("**bold**", "<strong>bold</strong>");
has("_italic_", "<em>italic</em>");
has("~~gone~~", "<del>gone</del>");
has("`code()`", "<code>code()</code>");
has("> quoted", "<blockquote>quoted</blockquote>");
has("---", "<hr>");
has("- one\n- two", "<ul><li>one</li><li>two</li></ul>");
has("1. one\n2. two", "<ol><li>one</li><li>two</li></ol>");
has("- [ ] todo", 'type="checkbox" disabled >todo');
has("- [x] done", 'type="checkbox" disabled checked>done');
has("```\nraw *stuff*\n```", "<pre><code>raw *stuff*</code></pre>");
has("[site](https://example.com)", '<a href="https://example.com" target="_blank">site</a>');
has("see https://example.com now", '<a href="https://example.com" target="_blank">https://example.com</a>');

// a list is closed before the next block, not left hanging
assert.strictEqual(md("- a\n\n# B"), "<ul><li>a</li></ul><h1>B</h1>");
// switching list type doesn't nest them
assert.strictEqual(md("- a\n1. b"), "<ul><li>a</li></ul><ol><li>b</li></ol>");
// an unterminated fence still renders as code rather than swallowing the rest
has("```\nhanging", "<pre><code>hanging</code></pre>");

// escaping: issue bodies come from GitHub, so untrusted HTML must never survive
const evil = md('<img src=x onerror="alert(1)"> <script>bad()</script>');
assert.ok(!evil.includes("<img"), evil);
assert.ok(!evil.includes("<script"), evil);
// and markup applied after escaping still works on the same line
has('<b>x</b> and **real**', "<strong>real</strong>");
// non-http schemes never become links
assert.ok(!md("[x](javascript:alert(1))").includes("<a "), md("[x](javascript:alert(1))"));

console.log("md: all checks passed");
