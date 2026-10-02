// What the coordinator receives when the project changes, in order. The human's chat
// message arrives as their own words; annotations they send arrive together as one
// structured message, with what each points at; everything else is news from the app,
// in its own message, carrying only the parts that changed. The human's messages are
// marked so that they try to reach a coordinator paused by its usage limit.
import { referenceLine } from "../src/domain/references.ts";

const NEWS = "News from the app. Act on what needs you, then end your turn.";

export function inbox(state, changed) {
  const { messages = [], ...rest } = changed;
  const news = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined && !(Array.isArray(value) && !value.length)),
  );
  const out = Object.keys(news).length ? [{ text: `${NEWS}\n\n${JSON.stringify(news, null, 1)}`, fromHuman: false }] : [];
  for (const m of messages) {
    if (m.author !== "human") continue;
    if (m.text?.trim()) out.push({ text: m.text, fromHuman: true });
    const annotations = m.annotations || [];
    if (annotations.length)
      out.push({
        text: `The human sent ${annotations.length === 1 ? "an annotation" : `${annotations.length} annotations`}:\n\n${JSON.stringify(
          annotations.map((a) => {
            const on = (a.references || []).map((r) => referenceLine(state, r));
            return { annotation: a.question, ...(on.length ? { on } : {}) };
          }),
          null,
          1,
        )}`,
        fromHuman: true,
      });
  }
  return out;
}
