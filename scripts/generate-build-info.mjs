/**
 * Generates build info from git history.
 * Run before build to embed version & commit info into the app.
 * Output: src/generated/buildInfo.json
 */
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'src/generated/buildInfo.json');
const VERSION_MAJOR = 0;
const VERSION_MINOR = 749;
const VERSION_PATCH_COMMIT_OFFSET = 235;

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function getDeterministicVersion() {
  const commitCount = Number(git(['rev-list', '--count', 'HEAD'])) || 0;
  const hasPendingTrackedChanges = Boolean(git(['status', '--porcelain', '--untracked-files=no']));
  const patch = Math.max(0, commitCount - VERSION_PATCH_COMMIT_OFFSET + (hasPendingTrackedChanges ? 1 : 0));
  return {
    version: `${VERSION_MAJOR}.${VERSION_MINOR}.${patch}`,
    previousVersion: `${VERSION_MAJOR}.${VERSION_MINOR}.${Math.max(0, patch - 1)}`,
  };
}

const lastTag = git(['describe', '--tags', '--abbrev=0']) || '';

// Get recent commits (since last tag, or last 20)
const defaultLogArgs = ['log', '--oneline', '-20', '--no-decorate'];
let logArgs = defaultLogArgs;
if (lastTag) {
  logArgs = ['log', `${lastTag}..HEAD`, '--oneline', '--no-decorate'];
  if (!git(logArgs)) logArgs = defaultLogArgs;
}

const rawLog = git(logArgs);
const commits = rawLog
  .split('\n')
  .filter(Boolean)
  .map(line => {
    const spaceIdx = line.indexOf(' ');
    return {
      hash: line.slice(0, spaceIdx),
      message: line.slice(spaceIdx + 1),
    };
  });

const commitMessages = commits.map(c => c.message);
const { version: newVersion, previousVersion } = getDeterministicVersion();
const commitHash = git(['rev-parse', '--short', 'HEAD']);
const branch = git(['branch', '--show-current']);
const buildDate = new Date().toISOString();

// Commit type → Greek label
const typeLabels = {
  'feat': 'Νέο χαρακτηριστικό',
  'fix': 'Διόρθωση',
  'refactor': 'Αναδιαμόρφωση',
  'style': 'Βελτίωση εμφάνισης',
  'perf': 'Βελτίωση απόδοσης',
  'docs': 'Τεκμηρίωση',
  'chore': 'Συντήρηση',
  'build': 'Build',
  'ci': 'CI/CD',
  'test': 'Δοκιμές',
};

function toGreekLabel(msg) {
  const m = msg.match(/^(feat|fix|refactor|chore|docs|style|perf|test|ci|build)(\(.+?\))?:\s*/i);
  const label = m ? typeLabels[m[1].toLowerCase()] || '' : '';
  const body = m ? msg.slice(m[0].length).trim() : msg;
  // Capitalize first char of body
  const cap = body.charAt(0).toUpperCase() + body.slice(1);
  return label ? `[${label}] ${cap}` : cap;
}

// Categorize changes for changelog
const changes = [];
for (const msg of commitMessages) {
  const clean = msg
    .replace(/^(feat|fix|refactor|chore|docs|style|perf|test|ci|build)(\(.+?\))?:\s*/i, '')
    .trim();
  if (clean && !clean.startsWith('Merge') && clean.length > 5) {
    changes.push(toGreekLabel(msg));
  }
}

const buildInfo = {
  version: newVersion,
  previousVersion,
  commitHash,
  branch,
  buildDate,
  commits: commits.slice(0, 15),
  changes: [...new Set(changes)].slice(0, 10), // deduplicate, max 10
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(buildInfo, null, 2), 'utf-8');

console.log(`Build info generated: v${newVersion} (${commitHash}) - ${changes.length} changes`);
