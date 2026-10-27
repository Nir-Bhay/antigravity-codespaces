import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { runCodespaceCommand, processRunnerLimits } from './process-runner.mjs';

const commandSchema = z.object({
  codespaceName: z.string().min(1).max(100).describe('Exact name of an existing GitHub Codespace.'),
  command: z.string().min(1).max(65_536).describe('Shell command or script to run in the Codespace.'),
  timeoutMs: z.number().int().min(1_000).max(processRunnerLimits.maxTimeoutMs).optional()
    .describe('Command timeout in milliseconds; defaults to 15 minutes and is capped at 6 hours.')
});

function formatRunResult(result) {
  const sections = [`Exit code: ${result.exitCode}`];
  if (result.timedOut) sections.push('The SSH process timed out and was terminated; a remote process may continue if it detached from the SSH session.');
  if (result.stdout) sections.push(`STDOUT:\n${result.stdout}`);
  if (result.stderr) sections.push(`STDERR:\n${result.stderr}`);
  if (result.outputTruncated) sections.push(`Output was truncated at ${processRunnerLimits.maxOutputChars} characters per stream.`);
  return sections.join('\n\n');
}

export function createCodespacesMcpServer({ runCommand = runCodespaceCommand } = {}) {
  const server = new McpServer({ name: 'antigravity-codespaces', version: '0.1.0' });

  server.registerTool(
    'run_codespace_command',
    {
      title: 'Run a command in a GitHub Codespace',
      description: 'Run a shell command in the named Codespace using the GitHub CLI authentication already configured on this computer. The command executes remotely; it is not run locally. The Codespace must already exist and be reachable by gh codespace ssh.',
      inputSchema: commandSchema
    },
    async ({ codespaceName, command, timeoutMs }, ctx) => {
      let progress = 0;
      let notificationQueue = Promise.resolve();
      const progressToken = ctx.mcpReq?._meta?.progressToken;
      try {
        const result = await runCommand(
          { codespaceName, command, timeoutMs: timeoutMs ?? processRunnerLimits.defaultTimeoutMs },
          {
            onOutput: (stream, chunk) => {
              if (progressToken === undefined) return;
              // Progress is monotonic, and the chunk remains visible while the tool is running.
              notificationQueue = notificationQueue.then(() => ctx.mcpReq.notify({
                method: 'notifications/progress',
                params: {
                  progressToken,
                  progress: ++progress,
                  message: `${stream}: ${chunk}`
                }
              }));
              return notificationQueue;
            }
          }
        );
        await notificationQueue;
        return {
          content: [{ type: 'text', text: formatRunResult(result) }],
          isError: result.exitCode !== 0
        };
      } catch (error) {
        await notificationQueue.catch(() => {});
        return { content: [{ type: 'text', text: error.message || 'Codespace command failed.' }], isError: true };
      }
    }
  );

  return server;
}
