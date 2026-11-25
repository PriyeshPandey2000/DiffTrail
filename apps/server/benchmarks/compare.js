// Keep the same runner and observations for single-extension and comparison runs.
process.env.BENCH_COMPARE = '1';
await import('./run.js');
