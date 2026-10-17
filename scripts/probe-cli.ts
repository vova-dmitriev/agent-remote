import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'claude-remote-probe-')),
  metadata = join(directory, 'events.jsonl'),
  hook = join(directory, 'hook.cjs'),
  settings = join(directory, 'settings.json');

const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";

await writeFile(
  hook,
  `const fs=require('node:fs');let data='';process.stdin.on('data',chunk=>data+=chunk);process.stdin.on('end',()=>{try{const r=JSON.parse(data);fs.appendFileSync(${JSON.stringify(metadata)},JSON.stringify({event:r.hook_event_name,sessionIdPresent:typeof r.session_id==='string',transcriptPathPresent:typeof r.transcript_path==='string'})+'\\n',{mode:0o600});}catch{};process.stdout.write('{}\\n');});`,
  { mode: 0o600 },
);

await writeFile(
  settings,
  JSON.stringify({
    hooks: Object.fromEntries(
      ['SessionStart', 'Stop', 'SessionEnd'].map((event) => [
        event,
        [{ hooks: [{ type: 'command', command: `${quote(process.execPath)} ${quote(hook)}`, timeout: 5 }] }],
      ]),
    ),
  }),
  { mode: 0o600 },
);

const result = await new Promise<{ pass: boolean; code: string; output: string }>((resolve) => {
  execFile(
    process.env.CLAUDE_EXECUTABLE ?? 'claude',
    [
      '-p',
      'Reply with exactly READY. Do not use tools.',
      '--output-format',
      'json',
      '--max-turns',
      '1',
      '--settings',
      settings,
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--tools',
      '',
    ],
    { cwd: directory, timeout: 60000, killSignal: 'SIGKILL', maxBuffer: 131072 },
    (error, stdout) => {
      if (error) {
        resolve({ pass: false, code: error.killed ? 'CLI_PROBE_TIMEOUT' : 'CLI_PROBE_FAILED', output: '' });

        return;
      }

      try {
        const value = JSON.parse(stdout);

        resolve({
          pass: typeof value.result === 'string' && value.result.trim() === 'READY',
          code: value.is_error ? 'CLI_ERROR' : 'OK',
          output: '',
        });
      } catch {
        resolve({ pass: false, code: 'CLI_PROBE_INVALID_RESPONSE', output: '' });
      }
    },
  );
});

let hooks: unknown[] = [];

try {
  hooks = (await readFile(metadata, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
} catch {}

const report = { ...result, hooks };

delete (report as { output?: string }).output;
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/cli-compatibility.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
await rm(directory, { recursive: true, force: true });
