// When a usage limit resets: the time alone when that is today, and with its date
// otherwise, since a weekly limit can be days away.
export function resetTime(ms: number, now = Date.now()): string {
  const at = new Date(ms);
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (at.toDateString() === new Date(now).toDateString()) return time;
  return `${time} on ${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
