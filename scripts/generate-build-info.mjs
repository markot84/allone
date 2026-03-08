/**
 * Generates build info from git history.
 * Run before build to embed version & commit info into the app.
 * Output: src/generated/buildInfo.json
 */
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'src/generated/buildInfo.json');

function git(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

function getLastRecordedVersion() {
  try {
    if (existsSync(OUT)) {
      const prev = JSON.parse(readFileSync(OUT, 'utf-8'));
      return prev.version || '0.0.0';
    }
  } catch { /* ignore */ }
  return '0.0.0';
}

function bumpVersion(prev, commits) {
  const [major, minor, patch] = prev.split('.').map(Number);
  const hasFeat = commits.some(c => c.startsWith('feat'));
  const hasFix = commits.some(c => c.startsWith('fix'));
  if (hasFeat) return `${major}.${minor + 1}.0`;
  if (hasFix) return `${major}.${minor}.${patch + 1}`;
  return `${major}.${minor}.${patch + 1}`;
}

// Get commits since last build info generation
const lastVersion = getLastRecordedVersion();
const lastTag = git('git describe --tags --abbrev=0 2>/dev/null') || '';

// Get recent commits (since last tag, or last 20)
let logCmd = 'git log --oneline -20 --no-decorate';
if (lastTag) {
  logCmd = `git log ${lastTag}..HEAD --oneline --no-decorate`;
  if (!git(logCmd)) logCmd = 'git log --oneline -20 --no-decorate';
}

const rawLog = git(logCmd);
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
const newVersion = bumpVersion(lastVersion, commitMessages);
const commitHash = git('git rev-parse --short HEAD');
const branch = git('git branch --show-current');
const buildDate = new Date().toISOString();

// Categorize changes for changelog
const changes = [];
for (const msg of commitMessages) {
  // Clean up: remove "feat: ", "fix: " prefix for display
  const clean = msg
    .replace(/^(feat|fix|refactor|chore|docs|style|perf|test|ci|build)(\(.+?\))?:\s*/i, '')
    .trim();
  if (clean && !clean.startsWith('Merge') && clean.length > 5) {
    changes.push(clean);
  }
}

const buildInfo = {
  version: newVersion,
  previousVersion: lastVersion,
  commitHash,
  branch,
  buildDate,
  commits: commits.slice(0, 15),
  changes: [...new Set(changes)].slice(0, 10), // deduplicate, max 10
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(buildInfo, null, 2), 'utf-8');

console.log(`Build info generated: v${newVersion} (${commitHash}) - ${changes.length} changes`);
