#!/usr/bin/env node
// PreToolUse hook (matcher: Edit|Write|Bash) — blocks any edit under the
// project's data-model/ folder (the source-of-truth design), as a second layer
// alongside the Edit(./data-model/**) deny rule in .claude/settings.json.
// Paths are resolved against the project root so that
// tests/integration/data-model/ stays editable.
// In Bash, the deny rule already covers sed, cat, tee and redirections, but not
// a script that opens files itself. So a Bash command that names data-model/,
// or runs inside it, is refused when it holds an inline script (python3 -,
// python3 -c, node -e, perl, sh -c) or mv, cp, rm. Scripts called by their
// path, such as the design-to-user-stories scripts, stay allowed.
'use strict';

const path = require('path');

// The start of a command, optionally behind sudo, env, exec, time or xargs.
const CMD = String.raw`(?:^|[;&|(\x60]|\$\()\s*(?:(?:sudo|env|exec|time|xargs)\s+)*`;
// Optional flags, then a script file, possibly through a variable such as
// $SKILL/scripts/x.py: the interpreter runs a file, not inline code. A word
// character right after the dashes gives each flag a single parse, so a long
// run of flags cannot backtrack exponentially.
const SCRIPT_FILE = String.raw`(?:\s+--?\w[\w-]*(?:=\S+)?)*\s+['"]?[\w./~$\{\}-]+\.(?:py|[cm]?js|ts|pl|rb|sh)\b`;
const INLINE_SCRIPT = new RegExp(
  String.raw`${CMD}(?:python[\d.]*|node|perl|ruby|bash|sh|zsh)\b(?!${SCRIPT_FILE})`,
  'm'
);
const FILE_COMMAND = new RegExp(String.raw`${CMD}(?:git\s+)?(?:mv|cp|rm)\b`, 'm');

function insideDataModel(root, target) {
  const rel = path.relative(root, path.resolve(root, target)).replace(/\\/g, '/');
  return rel === 'data-model' || rel.startsWith('data-model/');
}

function namesDataModel(command, root) {
  const absolute = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mention = String.raw`(?:(?:^|[\s'"\x60=(:,;|&<>{[])(?:\./)?|${absolute}/)data-model(?=[/\s'"\x60),;|&<>\]}]|$)`;
  return new RegExp(mention, 'm').test(command);
}

function denialReason(payload, root) {
  const toolInput = payload.tool_input || {};
  if (payload.tool_name === 'Bash') {
    const command = toolInput.command || '';
    const touches = namesDataModel(command, root) || insideDataModel(root, payload.cwd || root);
    if (touches && (INLINE_SCRIPT.test(command) || FILE_COMMAND.test(command))) {
      return 'data-model/ holds the source-of-truth design and must never be edited: no inline script (python3 -, node -e, perl, sh -c) and no mv, cp or rm on it. Read it with grep -n, sed -n, or Read with offset and limit.';
    }
    return null;
  }
  const filePath = toolInput.file_path || '';
  if (filePath && insideDataModel(root, filePath)) {
    return 'data-model/ holds the source-of-truth design and must never be edited (see .claude/settings.json hooks).';
  }
  return null;
}

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input);
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const reason = denialReason(payload, root);
    if (reason) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: reason,
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
