/**
 * Lightweight "Antigravity Codespaces" output-channel logger.
 *
 * Plain-node safe: when `vscode` is unavailable (unit tests), everything falls
 * back to console. In the extension host, errors also surface a "Show Logs"
 * action on toasts so normal users can see WHAT happened and what to do next.
 */
let vscode = null;
try { vscode = require('vscode'); } catch {}

let _channel = null;
function channel() {
    if (_channel) return _channel;
    if (!vscode) return null;
    try {
        _channel = vscode.window.createOutputChannel('Antigravity Codespaces');
        return _channel;
    } catch {
        return null;
    }
}

function stamp() {
    return new Date().toISOString().slice(11, 19);
}

function write(level, message, detail) {
    const line = `[${stamp()}] [${level}] ${message}` +
        (detail ? ` :: ${String(detail).slice(0, 500)}` : '');
    const ch = channel();
    if (ch) {
        try { ch.appendLine(line); } catch {}
    } else {
        try {
            if (level === 'ERROR') console.error(line);
            else if (level === 'WARN') console.warn(line);
            else console.log(line);
        } catch {}
    }
}

function info(message, detail) { write('INFO', message, detail); }
function warn(message, detail) { write('WARN', message, detail); }
function error(message, detail) { write('ERROR', message, detail); }

function show() {
    const ch = channel();
    if (ch) {
        try { ch.show(true); } catch {}
    }
}

module.exports = { info, warn, error, show };
