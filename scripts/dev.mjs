import { spawn } from 'node:child_process';
const processes = [
  spawn(process.execPath, ['--env-file-if-exists=.env', '--watch', 'server/index.mjs'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit' })
];
for (const p of processes) p.on('exit', code => { for (const other of processes) if (p !== other) other.kill(); process.exitCode = code || 0; });
process.on('SIGINT', () => processes.forEach(p => p.kill()));
process.on('SIGTERM', () => processes.forEach(p => p.kill()));
