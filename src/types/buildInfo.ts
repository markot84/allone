// CODE-B1: explicit type for src/generated/buildInfo.json. When the build runs in a
// clean checkout / with 0 commits, the generated JSON ships empty `commits`/`changes`
// arrays, which TypeScript infers as `never[]` — making `buildInfo.commits.map(c => c.hash)`
// and `change.match(...)` fail with TS2339. Importing the raw JSON and casting it to this
// interface pins the element types regardless of the JSON's runtime contents.
export interface BuildInfoCommit {
  hash: string;
  message: string;
}

export interface BuildInfo {
  version: string;
  previousVersion: string;
  commitHash: string;
  branch: string;
  buildDate: string;
  commits: BuildInfoCommit[];
  changes: string[];
}
