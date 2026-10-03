// uv, the Python package manager the app downloads for its own Python programs: a
// pinned release, checked against its published checksum, so nothing is needed
// beforehand but Node.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const UV_VERSION = "0.10.0";
const UV_RELEASES = {
  "darwin-arm64": ["uv-aarch64-apple-darwin.tar.gz", "82d4b99dc6ea686695b5ee142ceba03dd3e3eda2b414e94215ab7bce94972fbb"],
  "darwin-x64": ["uv-x86_64-apple-darwin.tar.gz", "664aed584c276f8d79cdc3b7685cd48f5d64657bd6840b06b4b2b0db731b9c99"],
  "linux-x64": ["uv-x86_64-unknown-linux-gnu.tar.gz", "230e328948c92dd1ebad83949c4d56e83813dfe9c6362a4c519e6a227973f1ae"],
  "linux-arm64": ["uv-aarch64-unknown-linux-gnu.tar.gz", "c300afd5f2d31df039fe6a26a2d68a76b62832098c272a43e1e74ab9efd4fbd7"],
  "win32-x64": ["uv-x86_64-pc-windows-msvc.zip", "4037b444541f695cd2eb93188a9346de3e334af562381411deade0a31c7bf898"],
  "win32-arm64": ["uv-aarch64-pc-windows-msvc.zip", "614dd3c409d7fb5a98b516d532c98db9b7799a23fb450150e3784338a9ebd903"],
};

const windows = process.platform === "win32";
export const uvExecutable = (folder) => join(folder, "uv", windows ? "uv.exe" : "uv");

// Downloads uv into folder/uv unless it is there already, and returns its path.
export async function downloadUv(folder, { unavailable = `This isn't available for ${process.platform} on ${process.arch}.` } = {}) {
  const uv = uvExecutable(folder);
  if (existsSync(uv)) return uv;
  const release = UV_RELEASES[`${process.platform}-${process.arch}`];
  if (!release) throw new Error(unavailable);
  const [asset, sha256] = release;
  const response = await fetch(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`);
  if (!response.ok) throw new Error(`Downloading uv failed (${response.status}).`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(archive).digest("hex") !== sha256) throw new Error("The downloaded uv did not match its published checksum.");
  const unpacked = join(folder, "uv");
  mkdirSync(unpacked, { recursive: true });
  const file = join(folder, asset);
  writeFileSync(file, archive);
  // tar comes with macOS, Linux and Windows 10 onward, and reads zip files too.
  const result = spawnSync("tar", ["-xf", file, "-C", unpacked, ...(windows ? [] : ["--strip-components", "1"])], { encoding: "utf8" });
  rmSync(file);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Unpacking uv failed: ${(result.stderr || "").trim()}`);
  return uv;
}
