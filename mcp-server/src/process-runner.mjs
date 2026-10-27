import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const MAX_OUTPUT_CHARS = 200_000;
const MAX_REMOTE_SCRIPT_CHARS = 80_000;
const CODESPACE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/;
const SENSITIVE_ENV_NAME_RE = /(TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY|ACCESS_KEY)/i;

export function safeChildEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([name]) => !SENSITIVE_ENV_NAME_RE.test(name)));
}

export function validateCodespaceName(codespaceName) {
  if (typeof codespaceName !== 'string' || !CODESPACE_NAME_RE.test(codespaceName)) {
    throw new TypeError('codespaceName must be a valid Codespace name.');
  }
  return codespaceName;
}

export function validateCommandInput({ command, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof command !== 'string' || command.trim().length === 0 || command.length > MAX_REMOTE_SCRIPT_CHARS) {
    throw new TypeError(`command must be a non-empty script of at most ${MAX_REMOTE_SCRIPT_CHARS} characters.`);
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError(`timeoutMs must be an integer between 1000 and ${MAX_TIMEOUT_MS}.`);
  }
  return { command, timeoutMs };
}

export function validateRunInput({ codespaceName, command, timeoutMs } = {}) {
  validateCodespaceName(codespaceName);
  return { codespaceName, ...validateCommandInput({ command, timeoutMs }) };
}

export function redactSensitiveText(text) {
  return String(text)
    .replace(/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/gi, '[REDACTED TOKEN]')
    .replace(/\bBearer\s+["']?[A-Za-z0-9._~+/-]{12,}=?["']?/gi, 'Bearer [REDACTED TOKEN]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED JWT]')
    .replace(/((?:^|[^A-Z0-9_.-])["']?[A-Z0-9_.-]{0,128}(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_.-]{0,128}["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1"[REDACTED]"');
}

function nextLineBoundary(text) {
  const newline = text.indexOf('\n');
  const carriageReturn = text.indexOf('\r');
  if (newline < 0) return carriageReturn;
  if (carriageReturn < 0) return newline;
  return Math.min(newline, carriageReturn);
}

/** Spawn a local process without a shell, stream bounded stdout/stderr, and enforce a deadline. */
export function runProcess(
  file,
  args,
  { spawnImpl = spawn, env = process.env, cwd, input, timeoutMs = DEFAULT_TIMEOUT_MS, onOutput = () => {}, maxOutputChars = MAX_OUTPUT_CHARS } = {}
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError(`timeoutMs must be an integer between 1000 and ${MAX_TIMEOUT_MS}.`);
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(file, args, { env: safeChildEnvironment(env), cwd, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      reject(new Error(`Could not start ${file}: ${error.message}`));
      return;
    }

    let stdout = '';
    let stderr = '';
    let outputTruncated = false;
    const redactionState = {
      stdout: { pending: '', rawLength: 0, stopped: false },
      stderr: { pending: '', rawLength: 0, stopped: false }
    };
    let timedOut = false;
    let inputError;
    let settled = false;
    let forceKillTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 5_000);
    }, timeoutMs);

    const appendSafeOutput = (streamName, rawLine) => {
      const state = redactionState[streamName];
      state.rawLength += rawLine.length;
      if (state.rawLength > maxOutputChars) {
        state.stopped = true;
        state.pending = '';
        outputTruncated = true;
        return;
      }
      const safeText = redactSensitiveText(rawLine);
      const current = streamName === 'stdout' ? stdout : stderr;
      const remaining = maxOutputChars - current.length;
      const accepted = safeText.slice(0, remaining);
      if (accepted.length < safeText.length) outputTruncated = true;
      if (streamName === 'stdout') stdout += accepted;
      else stderr += accepted;
      if (!accepted) return;
      try {
        Promise.resolve(onOutput(streamName, accepted)).catch(() => {});
      } catch {}
    };
    const capture = (streamName, chunk) => {
      const state = redactionState[streamName];
      if (state.stopped) return;
      state.pending += chunk.toString('utf8');
      let boundary;
      while ((boundary = nextLineBoundary(state.pending)) >= 0) {
        const line = state.pending.slice(0, boundary + 1);
        state.pending = state.pending.slice(boundary + 1);
        appendSafeOutput(streamName, line);
        if (state.stopped) return;
      }
      if (state.pending.length > maxOutputChars - state.rawLength) {
        state.pending = '';
        state.stopped = true;
        outputTruncated = true;
      }
    };
    const flushRedactionBuffers = () => {
      for (const streamName of ['stdout', 'stderr']) {
        const state = redactionState[streamName];
        if (state.pending && !state.stopped) {
          const remaining = state.pending;
          state.pending = '';
          appendSafeOutput(streamName, remaining);
        }
      }
    };

    if (input !== undefined && child.stdin) {
      child.stdin.once('error', error => { inputError = error; });
      child.stdin.end(input);
    }
    child.stdout?.on('data', chunk => capture('stdout', chunk));
    child.stderr?.on('data', chunk => capture('stderr', chunk));
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      reject(new Error(`${file} could not run: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      flushRedactionBuffers();
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      if (inputError) {
        reject(new Error(`Could not send input to ${file}: ${inputError.message}`));
        return;
      }
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

/** Run one explicitly requested command through the user's existing GitHub CLI authentication. */
export function runCodespaceCommand(
  input,
  { spawnImpl = spawn, ghPath = process.env.GH_PATH || 'gh', env = process.env, onOutput = () => {} } = {}
) {
  const { codespaceName, command, timeoutMs } = validateRunInput(input);
  const args = ['codespace', 'ssh', '--codespace', codespaceName, '--', command];
  return runProcess(ghPath, args, { spawnImpl, env, onOutput, input: input.input, timeoutMs });
}

export const processRunnerLimits = Object.freeze({
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  maxTimeoutMs: MAX_TIMEOUT_MS,
  maxOutputChars: MAX_OUTPUT_CHARS
});
