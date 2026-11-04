import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { generate } from "./generate.ts";
import { loadContent, loadGithubStats } from "./load.ts";
import { createMediaLoader } from "./media.ts";
import { repoRoot } from "./paths.ts";
import { apply, plan } from "./write.ts";

const HELP = `Generate the GitHub profile README and its SVG cards from the portfolio content.

Usage: npm run readme -- [options]

  --out-dir <dir>   folder for the SVG cards (default: assets/readme in the repo root)
  --readme <file>   README to write (default: README.md in the repo root)
  --check           write nothing; exit 1 if regenerating would change any file (for CI)
  --help            show this help

Environment:
  CONTENT_URL                   fetch content JSON from here
  SERVICE_ACCOUNT_BUCKET_NAME   else read https://storage.googleapis.com/<bucket>/content/site.json
                                (neither set → content/seed.json)
  GITHUB_TOKEN, GITHUB_USER     add GitHub stars/repos/followers (user defaults to the profile handle)
`;

export type CliArgs = { outDir: string | null; readme: string | null; check: boolean; help: boolean };

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { outDir: null, readme: null, check: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    const [flag, inline] = raw.includes("=") ? [raw.slice(0, raw.indexOf("=")), raw.slice(raw.indexOf("=") + 1)] : [raw, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === "") throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === "--out-dir") args.outDir = value();
    else if (flag === "--readme") args.readme = value();
    else if (flag === "--check") args.check = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else throw new Error(`unknown option ${raw}`);
  }
  return args;
}

const toPosix = (p: string) => p.split(sep).join("/");

export async function run(argv: string[], env: Record<string, string | undefined> = process.env): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`readme: ${(err as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  const root = repoRoot();
  // npm runs workspace scripts inside the workspace; resolve user paths from where npm was started.
  const base = env.INIT_CWD || process.cwd();
  const at = (p: string | null, fallback: string) => (p ? (isAbsolute(p) ? p : resolve(base, p)) : join(root, fallback));
  const outDir = at(args.outDir, join("assets", "readme"));
  const readmePath = at(args.readme, "README.md");

  const { content, source } = await loadContent(env);
  const github = await loadGithubStats(env, content.profile.handle);
  const media = createMediaLoader({ publicDir: join(root, "web", "public"), siteUrl: content.site.url });
  let currentReadme: string | null = null;
  try {
    currentReadme = await readFile(readmePath, "utf8");
  } catch {
    currentReadme = null;
  }
  const assetPath = toPosix(relative(dirname(readmePath), outDir)) || ".";
  const out = await generate({ content, github, media, currentReadme, assetPath });

  const rel = (p: string) => toPosix(relative(base, p)) || p;
  const summary = `content: ${source}; github stats: ${github ? `@${github.login}` : "off"}; ${out.files.size} SVGs`;
  if (args.check) {
    const p = await plan(out, outDir, readmePath);
    if (!p.changed.length && !p.removed.length) {
      console.log(`readme: up to date (${summary})`);
      return 0;
    }
    console.error(`readme: out of date (${summary}). Run \`npm run readme\` and commit the result.`);
    for (const f of p.changed) console.error(`  changed  ${rel(f)}`);
    for (const f of p.removed) console.error(`  stale    ${rel(f)}`);
    return 1;
  }
  const done = await apply(out, outDir, readmePath);
  console.log(`readme: ${summary}`);
  console.log(`readme: ${done.changed.length} file(s) written, ${done.removed.length} stale file(s) removed → ${rel(outDir)}, ${rel(readmePath)}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
