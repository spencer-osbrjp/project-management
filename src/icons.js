// 16px stroke icons (Lucide-style paths) — inline SVG so they inherit currentColor and need no font/dependency
const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icon = {
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  reopen: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  comment: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  issue: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
  plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  sync: svg('<path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3L3 16"/><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/>'),
  fetch: svg('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>'),
  pull: svg('<path d="M12 3v13"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/>'),
  push: svg('<path d="M12 21V8"/><path d="m7 13 5-5 5 5"/><path d="M5 3h14"/>'),
  commit: svg('<circle cx="12" cy="12" r="3.5"/><path d="M1.5 12h7"/><path d="M15.5 12h7"/>'),
  note: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/>'),

  // markdown toolbar
  heading: svg('<path d="M6 4v16"/><path d="M18 4v16"/><path d="M6 12h12"/>'),
  bold: svg('<path d="M6 4h7a4 4 0 0 1 0 8H6z"/><path d="M6 12h8a4 4 0 0 1 0 8H6z"/>'),
  italic: svg('<path d="M19 4h-9"/><path d="M14 20H5"/><path d="M15 4 9 20"/>'),
  quote: svg('<path d="M17 6H3"/><path d="M21 12H8"/><path d="M21 18H8"/><path d="M3 12v6"/>'),
  code: svg('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  listUl: svg('<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>'),
  listOl: svg('<path d="M10 6h11"/><path d="M10 12h11"/><path d="M10 18h11"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>'),
  task: svg('<path d="m3 8 2 2 4-4"/><path d="m3 17 2 2 4-4"/><path d="M13 9h8"/><path d="M13 18h8"/>'),
};
