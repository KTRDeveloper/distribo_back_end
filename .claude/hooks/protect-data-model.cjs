#!/usr/bin/env node
// PreToolUse hook (matcher: Edit|Write|Bash): a design file already used to
// generate stories is frozen and never changes; a change goes into a new
// addendum, included from the entry file.
// Frozen files are those docs/stories/STORY_MAP.md lists on its "- Included:"
// lines, or else the file on its "- Design:" line. Next to Included lines, the
// Design line names the entry file, which stays editable. When STORY_MAP.md
// cannot be read or names no design, every file under data-model/ counts as
// frozen.
// - Edit and Write: a frozen file is refused.
// - Bash: a write to a frozen file is refused: a redirection, tee, sed -i,
//   awk -i inplace, truncate, shred, dd of=, ed, ex, vi, patch, git checkout or
//   git restore, also after cd and through find -exec, find -delete or xargs.
//   A target hidden behind a variable counts as frozen when the command names a
//   frozen file or its folder.
// - Bash: a command that names data-model/, or runs inside it, is refused when
//   it holds an inline script (python3 -, python3 -c, node -e, perl, sh -c),
//   which opens files itself, or mv, cp or rm. Scripts called by their path,
//   such as the design-to-user-stories scripts, stay allowed.
// Paths are resolved against the project root, so tests/integration/data-model/
// stays editable. The Edit deny rule in .claude/settings.json is a second layer
// for the main design file.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const STORY_MAP = 'docs/stories/STORY_MAP.md';

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

const READ_HINT = 'Read it with grep -n, sed -n, or Read with offset and limit.';
const FOLDER_REASON =
  'data-model/ holds the design: no inline script (python3 -, node -e, perl, sh -c) and no mv, cp or rm on it. Create or change a file that is not frozen with Write or Edit. ' +
  READ_HINT;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function insideDataModel(root, target) {
  const rel = path.relative(root, path.resolve(root, target)).replace(/\\/g, '/');
  return rel === 'data-model' || rel.startsWith('data-model/');
}

// Whether the command names a path given relative to the project root, or
// absolute.
function namesPath(command, root, rel) {
  const mention = String.raw`(?:(?:^|[\s'"\x60=(:,;|&<>{[])(?:\./)?|${escapeRegExp(root)}/)${escapeRegExp(rel)}(?=[/\s'"\x60),;|&<>\]}]|$)`;
  return new RegExp(mention, 'm').test(command);
}

function namesDataModel(command, root) {
  return namesPath(command, root, 'data-model');
}

// Absolute paths of the frozen files, or null when every file under
// data-model/ counts as frozen.
function frozenFiles(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, STORY_MAP), 'utf8');
  } catch {
    return null;
  }
  const listed = (label) =>
    Array.from(
      text.matchAll(new RegExp(`^- ${label}: \`([^\`\\n]+)\``, 'gm')),
      (match) => match[1]
    );
  const included = listed('Included');
  const files = included.length > 0 ? included : listed('Design').slice(0, 1);
  return files.length > 0 ? files.map((file) => path.resolve(root, file)) : null;
}

// Shell operators: separators, redirections and here-documents. The fd forms
// (2>&1, >&2) come before the plain ones, so their & separates nothing.
const OPERATOR = /&&|\|\||;;|\|&|&>>|&>|\d*(?:>&|<&|>>|>\||>|<<<|<<-|<<|<>|<)|\$\(|[;\n|&()`]/y;
const WORD_END = /[\s;&|()<>`]/;
const SEPARATORS = new Set(['&&', '||', ';;', '|&', ';', '\n', '|', '&', '(', ')', '$(', '`']);

// One word from start: quotes and escapes removed, computed when it holds $, a
// backquote or a brace, glob when it holds an unquoted *, ? or [.
function readWord(command, start) {
  let text = '';
  let computed = false;
  let glob = false;
  let i = start;
  while (i < command.length && !WORD_END.test(command[i])) {
    const c = command[i];
    if (c === '\\') {
      if (command[i + 1] !== '\n') text += command.charAt(i + 1);
      i += 2;
    } else if (c === "'") {
      const close = command.indexOf("'", i + 1);
      const end = close < 0 ? command.length : close;
      text += command.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      i += 1;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === '\\') i += 1;
        else if (command[i] === '$' || command[i] === '`') computed = true;
        if (command[i] !== '\n' || command[i - 1] !== '\\') text += command.charAt(i);
        i += 1;
      }
      i += 1;
    } else {
      if ('${}'.includes(c)) computed = true;
      if ('*?['.includes(c)) glob = true;
      text += c;
      i += 1;
    }
  }
  if (command[start] === '~' && (text === '~' || text.startsWith('~/'))) {
    text = os.homedir() + text.slice(1);
  }
  return { text, computed, glob, end: Math.min(i, command.length) };
}

// Skips the bodies of the here-documents opened on the line that just ended:
// each runs up to a line holding only its delimiter.
function skipBodies(command, start, heredocs) {
  let i = start;
  for (const { delimiter, dash } of heredocs) {
    while (i < command.length) {
      const newline = command.indexOf('\n', i);
      const end = newline < 0 ? command.length : newline;
      const line = command.slice(i, end).replace(/\r$/, '');
      i = end + 1;
      if ((dash ? line.replace(/^\t+/, '') : line) === delimiter) break;
    }
  }
  return Math.min(i, command.length);
}

// A rough shell lexer: operator tokens and word tokens. Here-document bodies
// are data, so they are skipped.
function lex(command) {
  const tokens = [];
  const heredocs = [];
  let opening = null;
  let i = 0;
  while (i < command.length) {
    if (/[^\S\n]/.test(command[i])) {
      i += 1;
      continue;
    }
    OPERATOR.lastIndex = i;
    const operator = OPERATOR.exec(command);
    if (operator) {
      i = OPERATOR.lastIndex;
      tokens.push({ op: operator[0] });
      opening = /^\d*<<-?$/.test(operator[0]) ? { dash: operator[0].endsWith('-') } : null;
      if (operator[0] === '\n' && heredocs.length > 0) {
        i = skipBodies(command, i, heredocs.splice(0));
      }
      continue;
    }
    const word = readWord(command, i);
    i = Math.max(word.end, i + 1);
    tokens.push(word);
    if (opening) heredocs.push({ ...opening, delimiter: word.text });
    opening = null;
  }
  return tokens;
}

// The simple commands of a lexed command line: their words, and the files
// their output redirections write.
function simpleCommands(tokens) {
  const commands = [{ words: [], writes: [] }];
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    const current = commands[commands.length - 1];
    if (!token.op) {
      current.words.push(token);
    } else if (SEPARATORS.has(token.op)) {
      commands.push({ words: [], writes: [] });
    } else if (tokens[k + 1] && !tokens[k + 1].op) {
      // A redirection takes the next word: a file, an fd or a delimiter.
      const next = tokens[k + 1];
      k += 1;
      const fd = token.op.endsWith('&') && /^(?:\d+|-)$/.test(next.text);
      if (token.op.includes('>') && !fd) current.writes.push(next);
    }
  }
  return commands;
}

const PREFIXES = new Set([
  'sudo',
  'env',
  'exec',
  'time',
  'nohup',
  'nice',
  'command',
  'builtin',
  'stdbuf',
  'timeout',
  'xargs',
  '!',
  '{',
  '}',
  'if',
  'then',
  'else',
  'elif',
  'while',
  'until',
  'do',
]);
// Options of a prefix that take the next word as their value.
const VALUE_OPTIONS = {
  xargs: /^-[IndPLsaE]$/,
  sudo: /^-[ug]$/,
  env: /^-[uCS]$/,
  nice: /^-n$/,
  timeout: /^-[ks]$/,
};

// The command name after assignments, keywords and prefixes such as sudo or
// xargs, its arguments, and whether xargs feeds it.
function commandParts(words) {
  let k = 0;
  let viaXargs = false;
  while (k < words.length) {
    if (/^[A-Za-z_]\w*=/.test(words[k].text)) {
      k += 1;
      continue;
    }
    const name = path.basename(words[k].text);
    if (!PREFIXES.has(name)) break;
    viaXargs = viaXargs || name === 'xargs';
    k += 1;
    while (k < words.length && words[k].text.startsWith('-')) {
      k += VALUE_OPTIONS[name] && VALUE_OPTIONS[name].test(words[k].text) ? 2 : 1;
    }
    if (name === 'timeout') k += 1;
  }
  const name = k < words.length ? path.basename(words[k].text) : '';
  return { name, args: words.slice(k + 1), viaXargs };
}

const EDITORS = new Set([
  'tee',
  'truncate',
  'shred',
  'ed',
  'ex',
  'vi',
  'vim',
  'nvim',
  'nano',
  'patch',
]);
// A target whose path the command line does not show: xargs or find picks it.
const UNKNOWN = { text: '', computed: true, glob: false };

// The files a simple command writes in place, or null when it writes none.
function writtenFiles(name, args) {
  const operands = args.filter((word) => !word.text.startsWith('-'));
  if (EDITORS.has(name)) return operands;
  if (name === 'sed' || name === 'gsed') {
    return args.some((word) => /^-[A-Za-z]*i|^--in-place/.test(word.text)) ? operands : null;
  }
  if (name === 'awk' || name === 'gawk') {
    const options = args.map((word) => word.text).join(' ');
    const inPlace = /(?:^| )(?:--inplace|(?:-i ?|--include[ =])inplace(?:\.awk)?)(?: |$)/;
    return inPlace.test(options) ? operands : null;
  }
  if (name === 'dd') {
    const outputs = args.filter((word) => word.text.startsWith('of='));
    return outputs.length > 0
      ? outputs.map((word) => ({ ...word, text: word.text.slice(3) }))
      : null;
  }
  if (name === 'git') {
    let k = 0;
    while (k < args.length && args[k].text.startsWith('-'))
      k += /^-[Cc]$/.test(args[k].text) ? 2 : 1;
    const sub = k < args.length ? args[k].text : '';
    if (sub !== 'checkout' && sub !== 'restore') return null;
    return args.slice(k + 1).filter((word) => !word.text.startsWith('-'));
  }
  if (name === 'find') {
    if (args.some((word) => word.text === '-delete')) return [UNKNOWN];
    const exec = args.findIndex((word) => /^-(?:exec|execdir|ok|okdir)$/.test(word.text));
    if (exec < 0) return null;
    const rest = args.slice(exec + 1);
    const end = rest.findIndex((word) => word.text === ';' || word.text === '+');
    const nested = commandParts(end < 0 ? rest : rest.slice(0, end));
    const files = writtenFiles(nested.name, nested.args);
    return files ? [...files, UNKNOWN] : null;
  }
  return null;
}

const STAR = 0;
const ANY = 1;

// One path segment against glob tokens: the classic greedy match that falls
// back to the last star, so at worst the product of the lengths, never
// exponential.
function segmentMatch(tokens, text) {
  let t = 0;
  let j = 0;
  let star = -1;
  let mark = 0;
  while (j < text.length) {
    if (t < tokens.length && (tokens[t] === ANY || tokens[t] === text[j])) {
      t += 1;
      j += 1;
    } else if (t < tokens.length && tokens[t] === STAR) {
      star = t;
      t += 1;
      mark = j;
    } else if (star >= 0) {
      t = star + 1;
      mark += 1;
      j = mark;
    } else {
      return false;
    }
  }
  while (t < tokens.length && tokens[t] === STAR) t += 1;
  return t === tokens.length;
}

// Glob tokens of one segment; a bracket expression counts as any one character,
// which can only widen the match.
function globTokens(segment) {
  const tokens = [];
  for (let k = 0; k < segment.length; k += 1) {
    const close = segment[k] === '[' ? segment.indexOf(']', k + 2) : -1;
    if (segment[k] === '*') tokens.push(STAR);
    else if (segment[k] === '?') tokens.push(ANY);
    else if (close > 0) {
      tokens.push(ANY);
      k = close;
    } else tokens.push(segment[k]);
  }
  return tokens;
}

// Whether a path pattern matches a path; *, ? and [...] never cross a slash.
function globMatch(pattern, file) {
  const patternParts = pattern.split('/');
  const fileParts = file.split('/');
  return (
    patternParts.length === fileParts.length &&
    patternParts.every((part, k) => segmentMatch(globTokens(part), fileParts[k]))
  );
}

// Whether the command names a frozen file, or the folder holding one.
function mentionsFrozen({ command, root, frozen }) {
  if (!frozen) return namesDataModel(command, root);
  return frozen.some((file) => {
    const folder = path.relative(root, path.dirname(file)).replace(/\\/g, '/');
    const name = new RegExp(
      String.raw`(?:^|[\s'"\x60=(:,;|&<>{[/])${escapeRegExp(path.basename(file))}(?=[\s'"\x60),;|&<>\]}]|$)`,
      'm'
    );
    return (
      name.test(command) ||
      (folder !== '' && !folder.startsWith('..') && namesPath(command, root, folder))
    );
  });
}

// Whether one write target can be a frozen file. dir is the directory the
// command runs in, or null when a cd made it unknown.
function writesFrozen(target, dir, context) {
  const { root, frozen } = context;
  if (target.computed || (dir === null && !path.isAbsolute(target.text))) {
    const name = target.text.slice(target.text.lastIndexOf('/') + 1);
    if (!frozen || name === '' || /[$`{}]/.test(name)) return mentionsFrozen(context);
    return frozen.some((file) => globMatch(name, path.basename(file)));
  }
  const absolute = path.resolve(dir, target.text);
  return frozen
    ? frozen.some((file) => globMatch(absolute, file))
    : insideDataModel(root, absolute);
}

// The directory after cd or pushd, or null when the command line hides it.
function nextDirectory(name, dir, args) {
  const operand = args.find((word) => word.text === '-' || !word.text.startsWith('-'));
  if (!operand) return name === 'cd' ? os.homedir() : null;
  if (operand.text === '-' || operand.computed || operand.glob) return null;
  if (path.isAbsolute(operand.text)) return path.resolve(operand.text);
  return dir === null ? null : path.resolve(dir, operand.text);
}

// Whether the Bash command writes a frozen file.
function writesFrozenFile(command, cwd, context) {
  let dir = cwd;
  for (const { words, writes } of simpleCommands(lex(command))) {
    const { name, args, viaXargs } = commandParts(words);
    const files = writtenFiles(name, args) || [];
    const targets = [...writes, ...files];
    if (files.length > 0 && viaXargs) targets.push(UNKNOWN);
    if (targets.some((target) => writesFrozen(target, dir, context))) return true;
    if (name === 'cd' || name === 'pushd') dir = nextDirectory(name, dir, args);
  }
  return false;
}

function frozenReason(frozen, subject) {
  return frozen
    ? `${subject}, which docs/stories/STORY_MAP.md lists as used to generate stories: it is frozen and never changes. Write the change in a new addendum in data-model/ and add its include line to the entry file (see CLAUDE.md). ${READ_HINT}`
    : `${subject}, and docs/stories/STORY_MAP.md cannot be read or names no design, so every file under data-model/ counts as frozen. ${READ_HINT}`;
}

function denialReason(payload, root) {
  const toolInput = payload.tool_input || {};
  const frozen = frozenFiles(root);
  if (payload.tool_name === 'Bash') {
    const command = toolInput.command || '';
    const cwd = path.resolve(root, payload.cwd || root);
    const touches = namesDataModel(command, root) || insideDataModel(root, cwd);
    if (touches && (INLINE_SCRIPT.test(command) || FILE_COMMAND.test(command))) {
      return FOLDER_REASON;
    }
    if (writesFrozenFile(command, cwd, { command, root, frozen })) {
      return frozenReason(frozen, 'This command writes to a design file');
    }
    return null;
  }
  const filePath = toolInput.file_path || '';
  if (!filePath) return null;
  const target = path.resolve(root, filePath);
  const isFrozen = frozen ? frozen.includes(target) : insideDataModel(root, target);
  return isFrozen ? frozenReason(frozen, `${path.relative(root, target)} is a design file`) : null;
}

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch (err) {
    // Malformed input: fail open (do not block the tool call), but log so
    // this doesn't fail silently.
    process.stderr.write(
      `protect-data-model.cjs: failed to parse hook input, allowing tool call: ${err.message}\n`
    );
    return;
  }
  let reason;
  try {
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    reason = denialReason(payload, root);
  } catch (err) {
    // A failure while analysing the call: fail closed.
    reason = `protect-data-model.cjs could not check this call (${err.message}): rephrase it, or ask the user.`;
  }
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
});
