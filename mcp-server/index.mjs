#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createCodespacesMcpServer } from './src/server.mjs';

await serveStdio(createCodespacesMcpServer);
