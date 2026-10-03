#!/usr/bin/env node
// PreToolUse hook (matcher: Edit|Write) — blocks any edit under the
// project's data-model/ folder (the source-of-truth design), as a second layer
// alongside the Edit(./data-model/**) deny rule in .claude/settings.json.
// Paths are resolved against the project root so that
// tests/integration/data-model/ stays editable.
'use strict';

const path = require('path');

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input);
    const filePath = (payload.tool_input && payload.tool_input.file_path) || '';
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const rel = path.relative(root, path.resolve(root, filePath)).replace(/\\/g, '/');
    if (filePath && (rel === 'data-model' || rel.startsWith('data-model/'))) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              'data-model/ holds the source-of-truth design and must never be edited (see .claude/settings.json hooks).',
          },
        })
      );
    }
  } catch (err) {
    // Malformed input: fail open (do not block the tool call), but log so
    // this doesn't fail silently.
    process.stderr.write(
      `protect-data-model.cjs: failed to parse hook input, allowing tool call: ${err.message}\n`
    );
  }
});
