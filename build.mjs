import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

for (const file of ["index.html", "app.js", "styles.css"]) {
  await cp(file, `dist/${file}`);
}

let buildComment = "로컬 빌드";
try {
  const { stdout } = await exec("git", ["log", "-1", "--pretty=format:%h|%s"]);
  buildComment = stdout.trim() || buildComment;
} catch {}

const indexPath = "dist/index.html";
const index = await readFile(indexPath, "utf8");
await writeFile(indexPath, index.replaceAll("__BUILD_COMMENT__", buildComment.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")));