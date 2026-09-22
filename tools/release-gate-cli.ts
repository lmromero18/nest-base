import { runReleaseGate } from './release-gate';

const result = runReleaseGate();
console.log(JSON.stringify(result, null, 2));
if (!result.publicationAllowed) process.exitCode = 1;
