// Weir's mark: the stakes of a herring weir standing in the tide.
const stakes = "M4 7v9M8 5v11M12 4.5v11.5M16 5v11M20 7v9";
const tide = "M2.5 19.5c1.6-1.3 3.2-1.3 4.8 0s3.2 1.3 4.8 0 3.2-1.3 4.8 0 3.2 1.3 4.8 0";
// A herring facing right, centred on the origin: a slim body and a forked tail.
// A few of them are drawn behind the stakes, so they show between them as they
// pass through the weir.
const fish = "M3.3 0C2.5-.85 1-1.05-.3-.9-1.1-.8-1.7-.45-2.1 0-1.7.45-1.1.8-.3.9 1 1.05 2.5.85 3.3 0zM-1.9 0l-1.6-1.35.45 1.35-.45 1.35z";
// Each fish's place in the school: how far above the others it swims, and its size.
const school = [
  [0, 1],
  [-1.6, 0.8],
  [1.2, 0.9],
];
export const weirMark = `<svg class="weir-mark" viewBox="0 0 24 24" aria-hidden="true">
  <path d="${tide}" fill="none" stroke="var(--sea)" stroke-width="1.8" stroke-linecap="round"/>
  ${school.map(([y, size]) => `<g transform="translate(0 ${y}) scale(${size})"><path class="weir-fish" d="${fish}" fill="var(--rust)"/></g>`).join("")}
  <path d="${stakes}" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/>
</svg>`;

// The browser tab's icon: the mark on paper, so it shows on light and dark tabs alike.
export const weirIcon = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#f7f3e9"/><path d="${stakes}" stroke="#18333c" stroke-width="2" stroke-linecap="round"/><path d="${tide}" fill="none" stroke="#277177" stroke-width="1.8" stroke-linecap="round"/></svg>`,
)}`;
