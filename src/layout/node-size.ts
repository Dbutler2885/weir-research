// Node cards grow to show their full names.
export const NODE_WIDTH = 236;
const NAME_WIDTH = NODE_WIDTH - 28;
// Must match .node-name in styles.css; the weight alone changes widths by a tenth.
const NAME_FAMILY = '13.5px "Iowan Old Style", "Palatino Linotype", Palatino, serif';
const LINE_HEIGHT = 13.5 * 1.08;
// Beyond this the card clamps the name; the full name stays in the record.
export const MAX_NAME_LINES = 4;

let measure: OffscreenCanvasRenderingContext2D | null | undefined;
function nameLines(name: string): number {
  if (measure === undefined) {
    const canvas = typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(1, 1).getContext("2d");
    measure = null;
    // A browser that rejects the exact weight would silently measure a default font.
    for (const weight of ["720", "700", "bold"]) {
      if (!canvas) break;
      canvas.font = `${weight} ${NAME_FAMILY}`;
      if (canvas.font.includes("Iowan")) {
        measure = canvas;
        break;
      }
    }
  }
  let lines = 1;
  if (measure) {
    let line = "";
    for (const word of name.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (!line || measure.measureText(next).width <= NAME_WIDTH - 2) line = next;
      else {
        lines++;
        line = word;
      }
    }
  } else lines = Math.ceil((name.length * 7.6) / NAME_WIDTH);
  return Math.min(MAX_NAME_LINES, Math.max(2, lines));
}

// The name box below the type label, and the card around it with its dates line.
export function nodeNameHeight(lines: number): number {
  return Math.ceil(lines * LINE_HEIGHT) + 5;
}
export function nodeSize(name: string): { width: number; height: number } {
  return { width: NODE_WIDTH, height: nodeNameHeight(nameLines(name)) + 48 };
}
