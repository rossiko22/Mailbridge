// Mutation testing without a framework: plant one bug, run the tests that should catch it, put the file back.
//
//   npm run test:mutation               every mutation
//   npm run test:mutation -- throttle   only mutations whose name contains "throttle"
//
// Rules: a mutation whose `find` text does not occur exactly once is reported as NOT APPLIED and fails the run
// (it would otherwise "pass" without testing anything). The original file is restored byte for byte and checked
// by SHA-256 even when a test run crashes or is interrupted. Integration tests need the test database (see README).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { type Mutation, mutations } from './mutations.js';

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const filter = process.argv[2]?.toLowerCase();
const selected = mutations.filter(mutation => !filter || mutation.name.toLowerCase().includes(filter));

type Outcome = 'caught' | 'SURVIVED' | 'NOT APPLIED';

function run(mutation: Mutation): Outcome {
    const original = readFileSync(mutation.file);
    const checksum = sha256(original);
    const text = original.toString('utf8');
    if (text.split(mutation.find).length !== 2) return 'NOT APPLIED';
    const restore = () => {
        writeFileSync(mutation.file, original);
        if (sha256(readFileSync(mutation.file)) !== checksum) throw new Error(`Could not restore ${mutation.file}; restore it from git.`);
    };
    // Ctrl+C during a run must not leave the bug in the code.
    const onSignal = () => {
        restore();
        process.exit(130);
    };
    process.once('SIGINT', onSignal);
    try {
        writeFileSync(mutation.file, text.replace(mutation.find, mutation.replace));
        const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...mutation.tests], {
            stdio: 'ignore',
            env: { ...process.env, NODE_ENV: 'test' },
            timeout: 600_000,
        });
        return result.status === 0 ? 'SURVIVED' : 'caught';
    } finally {
        restore();
        process.off('SIGINT', onSignal);
    }
}

let failures = 0;
for (const mutation of selected) {
    const started = Date.now();
    const outcome = run(mutation);
    if (outcome !== 'caught') failures++;
    console.log(`${outcome.padEnd(11)} ${mutation.name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}
console.log(`\n${selected.length - failures} of ${selected.length} mutations caught.`);
if (!selected.length || failures) process.exitCode = 1;
