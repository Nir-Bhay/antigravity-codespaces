'use strict';
const { execFile } = require('child_process');

/**
 * Launches the IDE CLI and resolves only once we know how it went.
 * ok=true when the process exits 0, or is still running after settleMs (GUI launchers often keep running).
 * ok=false on spawn error or a non-zero exit within settleMs.
 */
function launchIde(exe, args, opts = {}) {
    const exec = opts.execFileImpl || execFile;
    const settleMs = opts.settleMs == null ? 4000 : opts.settleMs;
    return new Promise((resolve) => {
        let done = false;
        const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
        let child;
        try {
            child = exec(exe, args, { windowsHide: true }, () => {});
        } catch (err) {
            return resolve({ ok: false, reason: `Couldn't start ${exe}: ${err && err.message || err}` });
        }
        const timer = setTimeout(() => { finish({ ok: true }); if (child && child.unref) child.unref(); }, settleMs);
        if (!child || typeof child.on !== 'function') return finish({ ok: true });
        child.on('error', (err) => finish({ ok: false, reason: `Couldn't start the IDE launcher: ${err && err.message || err}` }));
        child.on('exit', (code) => finish(code === 0 || code == null ? { ok: true } : { ok: false, reason: `The IDE launcher exited with code ${code}.` }));
    });
}

module.exports = { launchIde };
