import { readFile, realpath } from 'node:fs/promises';

const [option, pid] = process.argv.slice(2);

if (option !== '--process-context' || !/^[1-9]\d*$/.test(pid ?? '')) {
  throw new Error('Expected --process-context and a positive PID');
}

const executable = await realpath(`/proc/${pid}/exe`);
const args = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').slice(1, -1);
const entries = (await readFile(`/proc/${pid}/environ`, 'utf8')).split('\0').filter(Boolean);

const env = Object.fromEntries(
  entries.map((entry) => {
    const separator = entry.indexOf('=');

    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }),
);

process.stdout.write(JSON.stringify({ executable, args, env }));
