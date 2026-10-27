import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const MAX_OUTPUT_CHARS = 200_000;
const CODESPACE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/;

export function validateRunInput({ codespaceName, command, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (typeof codespaceName !== 'string' || !CODESPACE_NAME_RE.test(codespaceName)) {
    throw new TypeError('codespaceName must be a valid Codespace name.');
  }
  if (typeof command !== 'string' || command.trim().length === 0 || command.length > 65_536) {
    throw new TypeError('command must be a non-empty script of at most 65536 characters.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError(`timeoutMs must be an integer between 1000 and ${MAX_TIMEOUT_MS}.`);
  }
  return { codespaceName, command, timeoutMs };
}

function appendBounded(current, chunk) {
  const remaining = MAX_OUTPUT_CHARS - current.length;
  return remaining <= 0 ? current : current + chunk.slice(0, remaining);
}

/** Run one explicitly requested command through the user's existing GitHub CLI authentication. */
export function runCodespaceCommand(
  input,
  { spawnImpl = spawn, ghPath = process.env.GH_PATH || 'gh', env = process.env, onOutput = () => {} } = {}
) {
  const { codespaceName, command, timeoutMs } = validateRunInput(input);
  const args = ['codespace', 'ssh', '--codespace', codespaceName, '--', command];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(ghPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      reject(new Error(`Could not start GitHub CLI: ${error.message}`));
      return;
    }

    let stdout = '';
    let stderr = '';
    let outputTruncated = false;
    let timedOut = false;
    let settled = false;
    let forceKillTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 5_000);
    }, timeoutMs);

    const capture = (streamName, target, chunk) => {
      const text = chunk.toString('utf8');
      const current = streamName === 'stdout' ? stdout : stderr;
      const next = appendBounded(current, text);
      const acceptedLength = next.length - current.length;
      if (acceptedLength < text.length) outputTruncated = true;
      if (streamName === 'stdout') stdout = next;
      else stderr = next;
      if (acceptedLength === 0) return;
      try {
        Promise.resolve(onOutput(streamName, text.slice(0, acceptedLength))).catch(() => {});
      } catch {}
    };

    child.stdout?.on('data', chunk => capture('stdout', stdout, chunk));
    child.stderr?.on('data', chunk => capture('stderr', stderr, chunk));
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      reject(new Error(`GitHub CLI could not run the Codespace command: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      resolve({
        exitCode: Number.isInteger(code) ? code : (timedOut ? 124 : 1),
        signal: signal || null,
        stdout,
        stderr,
        timedOut,
        outputTruncated
      });
    });
  });
}

export const processRunnerLimits = Object.freeze({
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  maxTimeoutMs: MAX_TIMEOUT_MS,
  maxOutputChars: MAX_OUTPUT_CHARS
});
