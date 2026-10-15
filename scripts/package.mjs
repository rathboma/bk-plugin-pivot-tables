// Builds the release zip Beekeeper Studio installs: {id}-{version}.zip with
// manifest.json and dist/ at the root. Run `yarn build` first.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

if (manifest.version !== pkg.version) {
  console.error(`manifest.json version (${manifest.version}) doesn't match package.json (${pkg.version})`);
  process.exit(1);
}
const tag = process.env.GITHUB_REF_NAME;
if (tag && tag.startsWith("v") && tag !== `v${manifest.version}`) {
  console.error(`Tag ${tag} doesn't match manifest version ${manifest.version}`);
  process.exit(1);
}
if (!existsSync("dist/index.html")) {
  console.error("dist/index.html not found. Run `yarn build` first.");
  process.exit(1);
}

mkdirSync("release", { recursive: true });
const zip = `release/${manifest.id}-${manifest.version}.zip`;
rmSync(zip, { force: true });
execFileSync("zip", ["-r", "-q", zip, "manifest.json", "dist", "README.md", "LICENSE"], { stdio: "inherit" });
console.log(`Created ${zip}`);
