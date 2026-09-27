// Weir's mark: the stakes of a herring weir standing in the tide.
const stakeLines = ["M4 7v9", "M8 5v11", "M12 4.5v11.5", "M16 5v11", "M20 7v9"];
const stakes = stakeLines.join("");
const tide = "M2.5 19.5c1.6-1.3 3.2-1.3 4.8 0s3.2 1.3 4.8 0 3.2-1.3 4.8 0 3.2 1.3 4.8 0";
// A herring facing right, centred on the origin: a slim body and a forked tail.
const fish = "M3.3 0C2.5-.85 1-1.05-.3-.9-1.1-.8-1.7-.45-2.1 0-1.7.45-1.1.8-.3.9 1 1.05 2.5.85 3.3 0zM-1.9 0l-1.6-1.35.45 1.35-.45 1.35z";
// The school: how far above the others each fish swims, its size, how long after
// the first it leaps, and the gap it slips through, counting stakes from the left.
const school = [
  { y: 0, size: 1, delay: 0, gap: 2 },
  { y: -1.2, size: 0.8, delay: 0.5, gap: 3 },
  { y: 0.9, size: 0.9, delay: 1.1, gap: 1 },
];

// A fish passes in front of the stakes before its gap and behind the ones after it:
// its mask hides it wherever those later stakes stand.
const leap = ({ y, size, delay, gap }: (typeof school)[number], n: number) =>
  `<mask id="weir-gap-${n}" maskUnits="userSpaceOnUse" x="-6" y="-6" width="36" height="36"><rect x="-6" y="-6" width="36" height="36" fill="#fff"/><path d="${stakeLines.slice(gap).join("")}" stroke="#000" stroke-width="2" stroke-linecap="round"/></mask>` +
  `<g mask="url(#weir-gap-${n})"><g transform="translate(0 ${y}) scale(${size})" style="--leap-delay: ${delay}s"><g class="weir-swim"><path class="weir-fish" d="${fish}" fill="var(--rust)"/></g></g></g>`;

export const weirMark = `<svg class="weir-mark" viewBox="0 0 24 24" aria-hidden="true">
  <path d="${tide}" fill="none" stroke="var(--sea)" stroke-width="1.8" stroke-linecap="round"/>
  <path d="${stakes}" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/>
  ${school.map(leap).join("")}
</svg>`;

// The browser tab's icon: the mark on paper, so it shows on light and dark tabs alike.
export const weirIcon = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#f7f3e9"/><path d="${stakes}" stroke="#18333c" stroke-width="2" stroke-linecap="round"/><path d="${tide}" fill="none" stroke="#277177" stroke-width="1.8" stroke-linecap="round"/></svg>`,
)}`;
