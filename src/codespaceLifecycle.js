'use strict';

const TRANSITIONAL_STATES = new Set([
    'awaiting', 'creating', 'deleting', 'exporting', 'importing', 'moved',
    'provisioning', 'queued', 'rebuilding', 'starting', 'shuttingdown'
]);

function humanizeState(state) {
    return String(state || '')
        .trim()
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, letter => letter.toUpperCase());
}

/** Only GitHub's explicit Available and Shutdown states permit start/stop actions. */
function classifyCodespaceState(state) {
    const raw = typeof state === 'string' ? state.trim() : '';
    const normalized = raw.toLowerCase();
    if (normalized === 'available') return { kind: 'running', label: 'Running', raw, actionable: true };
    if (normalized === 'shutdown') return { kind: 'stopped', label: 'Stopped', raw, actionable: true };
    if (TRANSITIONAL_STATES.has(normalized)) return { kind: 'transitioning', label: humanizeState(raw), raw, actionable: false };
    return { kind: 'unknown', label: raw ? humanizeState(raw) : 'State unavailable', raw, actionable: false };
}

function targetName(codespace) {
    return String(codespace && (codespace.displayName || codespace.name) || 'Codespace');
}

function targetAccount(codespace) {
    return String(codespace && codespace.account || 'unknown account');
}

function createConfirmationText({ account, repository, branch }) {
    const branchTarget = branch ? ` on branch "${branch}"` : ' on the repository default branch';
    return `Create a Codespace for "${repository}"${branchTarget} under GitHub account "${account}"? It will start using compute while it runs, which can consume included quota or incur charges depending on GitHub's plan and spending limits. Storage is billed while the Codespace exists, including when stopped, until it is deleted. GitHub may bill the repository owner or organization; usage totals can be delayed.`;
}

function startConfirmationText(codespace) {
    const target = targetName(codespace);
    const account = targetAccount(codespace);
    return `Start "${target}" under GitHub account "${account}"? Compute usage resumes while it runs and may consume included quota or incur charges. Storage billing continues while the Codespace exists, including after it is stopped.`;
}

function stopConfirmationText(codespace) {
    const target = targetName(codespace);
    const account = targetAccount(codespace);
    return `Stop "${target}" under GitHub account "${account}"? This stops compute usage after GitHub shuts it down, but does not delete the Codespace or stop storage billing. Storage continues until the Codespace is deleted.`;
}

function deleteConfirmationText(codespace) {
    const target = targetName(codespace);
    const account = targetAccount(codespace);
    const state = classifyCodespaceState(codespace && codespace.state).label;
    const repo = codespace && codespace.repository ? ` · repository ${codespace.repository}` : '';
    return `Permanently delete "${target}" for GitHub account "${account}"${repo}? Current GitHub state: ${state}. This cannot be undone; uncommitted or unpushed Codespace changes may be lost. Deletion removes this Codespace's stored workspace and stops further storage accrual after GitHub removes it. The GitHub repository itself is not deleted.`;
}

module.exports = {
    classifyCodespaceState,
    createConfirmationText,
    startConfirmationText,
    stopConfirmationText,
    deleteConfirmationText
};
