#!/usr/bin/env node
// PreToolUse hook (matcher: Edit|Write) — blocks any edit to the protected
// source-of-truth data model doc, as a second layer alongside the
// permissions.deny rule in .claude/settings.json.
'use strict';

const PROTECTED = /(^|[/\\])data-model[/\\]modele-donnees-livraisons\.md$/;

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input);
    const filePath = (payload.tool_input && payload.tool_input.file_path) || '';
    if (PROTECTED.test(filePath.replace(/\\/g, '/'))) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              'data-model/modele-donnees-livraisons.md is protected and must never be edited (see .claude/settings.json hooks).',
          },
        })
      );
    }
  } catch {
    // Malformed input: fail open, do not block.
  }
});
