import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// The app's instruction skills, read from their frontmatter so the coordinator
// sees what each is for and loads one only when it needs it.
export function projectSkills(root) {
  const directory = join(root, "skills");
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = join(directory, entry.name, "SKILL.md");
      if (!existsSync(file)) return null;
      const header = readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1] || "";
      const field = (key) => {
        const raw = header.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1]?.trim() || "";
        return raw.startsWith('"') ? JSON.parse(raw) : raw;
      };
      return { name: field("name") || entry.name, description: field("description") };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}
