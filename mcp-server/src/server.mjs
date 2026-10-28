import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { createCodespaceManager } from './codespace-manager.mjs';
import { runCodespaceCommand, processRunnerLimits } from './process-runner.mjs';

const timeoutSchema = z.number().int().min(1_000).max(processRunnerLimits.maxTimeoutMs).optional()
  .describe('Command timeout in milliseconds; defaults to 15 minutes and is capped at 6 hours.');
const commandSchema = z.object({
  codespaceName: z.string().min(1).max(100).describe('Exact name of an existing GitHub Codespace.'),
  command: z.string().min(1).max(65_536).describe('Shell command or script to run in the Codespace.'),
  timeoutMs: timeoutSchema
});
const repositoryCommandSchema = z.object({
  command: z.string().min(1).max(65_536).describe('Shell command or script to run remotely.'),
  cwd: z.string().max(4_096).optional().describe('Local project directory; defaults to the MCP server process working directory.'),
  timeoutMs: timeoutSchema,
  syncLocalChanges: z.boolean().optional().describe('Opt in to transfer the exact staged/unstaged tracked changes and non-ignored untracked files from a recent preview. This may include private files; inspect the preview before approving.'),
  localChangesPreviewId: z.string().min(1).max(64).optional().describe('Single-use previewId returned by preview_local_changes; required when syncLocalChanges=true. Preview expires after 10 minutes and is rejected if local changes or repository context differ.')
});
const localContextSchema = z.object({
  cwd: z.string().max(4_096).optional().describe('Local project directory; defaults to the MCP server process working directory.')
});
const codespaceNameSchema = z.object({
  codespaceName: z.string().min(1).max(100).describe('Exact Codespace name.')
});

function formatRunResult(result) {
  const sections = [`Exit code: ${result.exitCode}`];
  if (result.timedOut) sections.push('The SSH process timed out and was terminated; a remote process may continue if it detached from the SSH session.');
  if (result.stdout) sections.push(`STDOUT:\n${result.stdout}`);
  if (result.stderr) sections.push(`STDERR:\n${result.stderr}`);
  if (result.outputTruncated) sections.push(`Output was truncated at ${processRunnerLimits.maxOutputChars} characters per stream.`);
  return sections.join('\n\n');
}

function progressReporter(ctx) {
  let progress = 0;
  let queue = Promise.resolve();
  const token = ctx.mcpReq?._meta?.progressToken;
  return {
    onOutput(stream, chunk) {
      if (token === undefined) return;
      queue = queue.then(() => ctx.mcpReq.notify({
        method: 'notifications/progress',
        params: { progressToken: token, progress: ++progress, message: `${stream}: ${chunk}` }
      }));
      return queue;
    },
    flush() { return queue; }
  };
}

function outputResult(text, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

function summarizeCodespace(codespace) {
  return {
    name: codespace.name,
    displayName: codespace.displayName || codespace.display_name || codespace.name,
    repository: typeof codespace.repository === 'string' ? codespace.repository : codespace.repository?.full_name || '',
    branch: codespace.gitStatus?.ref || codespace.git_status?.ref || '',
    state: codespace.state || '',
    machine: codespace.machineName || codespace.machine?.name || '',
    location: codespace.location || '',
    lastUsedAt: codespace.lastUsedAt || codespace.last_used_at || ''
  };
}

function safeStatus(status) {
  return {
    ...summarizeCodespace(status),
    idleTimeoutMinutes: status.idle_timeout_minutes || status.idleTimeoutMinutes || null
  };
}

export function createCodespacesMcpServer({ runCommand = runCodespaceCommand, manager } = {}) {
  const codespaceManager = manager || createCodespaceManager({ runCommand });
  const server = new McpServer({ name: 'antigravity-codespaces', version: '0.1.0' });

  server.registerTool(
    'check_setup',
    {
      title: 'Check MCP setup without provisioning',
      description: 'Read-only preflight for Node.js, GitHub CLI installation/authentication, the Codespaces permission scope, and the local GitHub repository/branch. Never lists, starts, or creates a Codespace.',
      inputSchema: localContextSchema
    },
    async ({ cwd }) => {
      try {
        return outputResult(JSON.stringify(await codespaceManager.preflightRepository({ cwd }), null, 2));
      } catch (error) {
        return outputResult(error.message || 'Setup preflight failed.', true);
      }
    }
  );

  server.registerTool(
    'preview_local_changes',
    {
      title: 'Preview local changes before syncing',
      description: 'Read-only preview of changed tracked and non-ignored untracked file names and patch size. Does not return file contents, contact GitHub, or provision a Codespace. Ignored files are excluded. Review the file list and patch size, then pass the returned previewId as localChangesPreviewId when opting into syncLocalChanges; changes to repository context or patch are rejected.',
      inputSchema: localContextSchema
    },
    async ({ cwd }) => {
      try {
        return outputResult(JSON.stringify(await codespaceManager.previewLocalChanges({ cwd }), null, 2));
      } catch (error) {
        return outputResult(error.message || 'Could not preview local changes.', true);
      }
    }
  );

  server.registerTool(
    'run_codespace_command',
    {
      title: 'Run a command in a GitHub Codespace',
      description: 'Run a shell command in the named Codespace using the active GitHub CLI account on this computer. The command executes remotely, not locally. The Codespace must already exist and be reachable by gh codespace ssh.',
      inputSchema: commandSchema
    },
    async ({ codespaceName, command, timeoutMs }, ctx) => {
      const reporter = progressReporter(ctx);
      try {
        const result = await runCommand(
          { codespaceName, command, timeoutMs: timeoutMs ?? processRunnerLimits.defaultTimeoutMs },
          { onOutput: reporter.onOutput }
        );
        await reporter.flush();
        return { ...outputResult(formatRunResult(result), result.exitCode !== 0), structuredContent: result };
      } catch (error) {
        await reporter.flush().catch(() => {});
        return outputResult(error.message || 'Codespace command failed.', true);
      }
    }
  );

  server.registerTool(
    'run_repository_command',
    {
      title: 'Run a command in this project’s Codespace',
      description: 'Detect the local GitHub repository and branch, reuse an exact matching Codespace, start it if stopped, or create one if none matches. To sync, first call preview_local_changes, review the file names and transfer size, then set syncLocalChanges=true and pass its single-use previewId as localChangesPreviewId. The preview expires after 10 minutes and sync is refused if repository context or patch changed; only the reviewed patch is transferred. This may include private files. Changes are applied in a temporary detached worktree. This requires identical local and Codespace HEAD commits and never changes branch history. A newly created or started Codespace is stopped after the command; an already running Codespace is left running. Creating or starting can incur compute charges, and stopped Codespaces still incur storage charges.',
      inputSchema: repositoryCommandSchema
    },
    async ({ command, cwd, timeoutMs, syncLocalChanges, localChangesPreviewId }, ctx) => {
      const reporter = progressReporter(ctx);
      try {
        const summary = await codespaceManager.runRepositoryCommand({ command, cwd, timeoutMs, syncLocalChanges, localChangesPreviewId, onOutput: reporter.onOutput });
        await reporter.flush();
        const metadata = [
          `Repository: ${summary.repository}`,
          `Branch: ${summary.branch}`,
          `Codespace: ${summary.codespaceName}`,
          `Created by server: ${summary.created ? 'yes' : 'no'}`,
          `Started by server: ${summary.started ? 'yes' : 'no'}`,
          `Stopped after command: ${summary.stoppedAfterRun ? 'yes' : 'no'}`,
          `Local changes synced: ${summary.localChangesSynced ? 'yes' : 'no'}`
        ];
        if (summary.cleanupError) metadata.push(`Cleanup warning: ${summary.cleanupError}`);
        return {
          ...outputResult(`${metadata.join('\n')}\n\n${formatRunResult(summary.result)}`, summary.result.exitCode !== 0 || Boolean(summary.cleanupError)),
          structuredContent: summary
        };
      } catch (error) {
        await reporter.flush().catch(() => {});
        return outputResult(error.message || 'Repository Codespace command failed.', true);
      }
    }
  );

  server.registerTool(
    'list_codespaces',
    {
      title: 'List Codespaces',
      description: 'List Codespaces visible to the active GitHub CLI account without starting them.',
      inputSchema: z.object({})
    },
    async () => {
      try {
        const result = await codespaceManager.listCodespaces();
        return outputResult(JSON.stringify(result.map(summarizeCodespace), null, 2));
      } catch (error) {
        return outputResult(error.message || 'Could not list Codespaces.', true);
      }
    }
  );

  server.registerTool(
    'get_codespace_status',
    {
      title: 'Get Codespace status',
      description: 'Read current state and machine details for one Codespace.',
      inputSchema: codespaceNameSchema
    },
    async ({ codespaceName }) => {
      try {
        return outputResult(JSON.stringify(safeStatus(await codespaceManager.getCodespace(codespaceName)), null, 2));
      } catch (error) {
        return outputResult(error.message || 'Could not read Codespace status.', true);
      }
    }
  );

  server.registerTool(
    'start_codespace',
    {
      title: 'Start a Codespace',
      description: 'Start a stopped Codespace and wait for it to become available. This can incur compute charges; the Codespace is left running for subsequent use.',
      inputSchema: codespaceNameSchema
    },
    async ({ codespaceName }) => {
      try {
        return outputResult(JSON.stringify(safeStatus(await codespaceManager.startCodespace(codespaceName)), null, 2));
      } catch (error) {
        return outputResult(error.message || 'Could not start Codespace.', true);
      }
    }
  );

  server.registerTool(
    'stop_codespace',
    {
      title: 'Stop a Codespace',
      description: 'Stop a running Codespace to end compute usage. Its storage can continue to incur charges; this tool never deletes a Codespace.',
      inputSchema: codespaceNameSchema
    },
    async ({ codespaceName }) => {
      try {
        await codespaceManager.stopCodespace(codespaceName);
        return outputResult(`Stopped Codespace ${codespaceName}.`);
      } catch (error) {
        return outputResult(error.message || 'Could not stop Codespace.', true);
      }
    }
  );

  server.registerTool(
    'get_codespace_logs',
    {
      title: 'Read Codespace logs',
      description: 'Read logs for one Codespace. Logs can contain sensitive output; review before sharing them.',
      inputSchema: codespaceNameSchema
    },
    async ({ codespaceName }) => {
      try {
        return outputResult(await codespaceManager.getCodespaceLogs(codespaceName));
      } catch (error) {
        return outputResult(error.message || 'Could not read Codespace logs.', true);
      }
    }
  );

  server.registerTool(
    'get_codespace_ports',
    {
      title: 'List Codespace ports and URLs',
      description: 'List forwarded ports and URLs for one Codespace. A forwarded URL may grant access to a running service.',
      inputSchema: codespaceNameSchema
    },
    async ({ codespaceName }) => {
      try {
        return outputResult(JSON.stringify(await codespaceManager.getCodespacePorts(codespaceName), null, 2));
      } catch (error) {
        return outputResult(error.message || 'Could not read Codespace ports.', true);
      }
    }
  );

  return server;
}
