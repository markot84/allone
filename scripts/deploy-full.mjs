/**
 * Full deploy: firebase:deploy:full, then git add/commit (if needed), git push.
 * Optional: DEPLOY_COMMIT_MSG="your message" npm run deploy:full
 */
import { execSync } from 'node:child_process';

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', shell: true, ...opts });
}

function hasStagedChanges() {
  try {
    execSync('git diff --staged --quiet', { stdio: 'ignore' });
    return false;
  } catch {
    return true;
  }
}

console.log('→ firebase:deploy:full\n');
run('npm run firebase:deploy:full');

console.log('\n→ git add -A\n');
run('git add -A');

if (hasStagedChanges()) {
  const msg = process.env.DEPLOY_COMMIT_MSG?.trim() || 'chore: full deploy';
  console.log(`\n→ git commit (${JSON.stringify(msg)})\n`);
  run(`git commit -m ${JSON.stringify(msg)}`);
} else {
  console.log('\n→ (κανένα staged αλλαγή — παράλειψη commit)\n');
}

console.log('\n→ git push\n');
run('git push');

console.log('\n✓ deploy:full ολοκληρώθηκε\n');
