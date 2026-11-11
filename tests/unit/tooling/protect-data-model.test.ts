import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The PreToolUse hook reads the tool call as JSON on stdin and prints a deny
// decision, or nothing to let the call through. Besides path arithmetic it
// only reads docs/stories/STORY_MAP.md: the fake root /repo has none, so all of
// data-model/ stays frozen there; the other tests write a STORY_MAP.md in a
// temporary project root.
const HOOK = '.claude/hooks/protect-data-model.cjs';
const ROOT = '/repo';
const DESIGN = 'data-model/modele-donnees-livraisons-v16.md';

function decide(
  toolName: string,
  toolInput: Record<string, string>,
  cwd = ROOT,
  root = ROOT
): string | undefined {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput, cwd }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    // The hook runs before every Bash call: one that hangs gives no decision.
    timeout: 3000,
  });
  if (!result.stdout) return undefined;
  const output = JSON.parse(result.stdout) as {
    hookSpecificOutput: { permissionDecision: string };
  };
  return output.hookSpecificOutput.permissionDecision;
}

const bash = (command: string, cwd?: string): string | undefined =>
  decide('Bash', { command }, cwd);

describe('protect-data-model hook', () => {
  it('denies Edit and Write under data-model/, not under tests/integration/data-model/', () => {
    expect(decide('Edit', { file_path: DESIGN })).toBe('deny');
    expect(decide('Write', { file_path: `${ROOT}/${DESIGN}` })).toBe('deny');
    expect(decide('Edit', { file_path: 'tests/integration/data-model/x.test.ts' })).toBeUndefined();
  });

  it('denies an inline script that names data-model/', () => {
    expect(bash(`python3 - <<'EOF'\np = '${DESIGN}'\nopen(p, 'w').write('')\nEOF`)).toBe('deny');
    expect(bash(`python3 -c "open('./${DESIGN}', 'w')"`)).toBe('deny');
    expect(bash(`node -e "require('fs').writeFileSync('${DESIGN}', '')"`)).toBe('deny');
    expect(bash(`perl -pi -e 's/a/b/' ${DESIGN}`)).toBe('deny');
    expect(bash(`sh -c "echo > ${DESIGN}"`)).toBe('deny');
    expect(bash(`cd /tmp && python3 -c "open('${ROOT}/${DESIGN}', 'w')"`)).toBe('deny');
  });

  it('denies an inline script run from inside data-model/', () => {
    expect(bash(`python3 -c "open('x.md', 'w')"`, `${ROOT}/data-model`)).toBe('deny');
  });

  it('denies mv, cp and rm on data-model/', () => {
    expect(bash(`mv ${DESIGN} /tmp/design.md`)).toBe('deny');
    expect(bash(`cp /tmp/design.md ${DESIGN}`)).toBe('deny');
    expect(bash('rm -rf data-model')).toBe('deny');
    expect(bash(`git rm ${DESIGN}`)).toBe('deny');
  });

  it('decides at once on a long run of --flags', () => {
    expect(bash(`node${' --flag'.repeat(40)} ${DESIGN}`)).toBe('deny');
  });

  it('allows reads of data-model/ and scripts called by their path', () => {
    expect(bash(`grep -n '^## ' ${DESIGN}`)).toBeUndefined();
    expect(bash(`sed -n '10,40p' ${DESIGN}`)).toBeUndefined();
    expect(
      bash(`python3 .claude/skills/design-to-user-stories/scripts/index_design.py ${DESIGN}`)
    ).toBeUndefined();
    expect(
      bash(`SKILL=.claude/skills/design-to-user-stories && python3 $SKILL/scripts/x.py ${DESIGN}`)
    ).toBeUndefined();
    expect(bash(`python3 "\${SKILL}/scripts/x.py" --design ${DESIGN}`)).toBeUndefined();
  });

  it('allows inline scripts and file commands elsewhere', () => {
    expect(bash(`python3 - <<'EOF'\nopen('src/app.ts', 'w')\nEOF`)).toBeUndefined();
    expect(
      bash(`python3 -c "open('tests/integration/data-model/x.test.ts', 'w')"`)
    ).toBeUndefined();
    expect(bash('rm -f /tmp/out.txt && npx vitest run tests/unit')).toBeUndefined();
  });

  it('denies a write anywhere under data-model/ while STORY_MAP.md cannot be read', () => {
    expect(bash('echo x >> data-model/conception.md')).toBe('deny');
    expect(bash("sed -i 's/a/b/' data-model/conception.md")).toBe('deny');
  });
});

// A design file that STORY_MAP.md lists as used to generate stories is frozen;
// the entry file that includes it, and a new addendum, stay editable.
describe('protect-data-model hook with a STORY_MAP.md', () => {
  const ENTRY = 'data-model/conception.md';
  const ADDENDUM = 'data-model/modele-donnees-livraisons-v16-addendum.md';
  const NEW_ADDENDUM = 'data-model/modele-donnees-livraisons-v16-addendum-2.md';
  let parent: string;
  let listed: string;
  let single: string;
  let unnamed: string;

  function project(name: string, lines: string[]): string {
    const root = join(parent, name);
    mkdirSync(join(root, 'docs/stories'), { recursive: true });
    writeFileSync(
      join(root, 'docs/stories/STORY_MAP.md'),
      ['# Story map', '', ...lines, ''].join('\n')
    );
    return root;
  }

  beforeAll(() => {
    parent = mkdtempSync(join(tmpdir(), 'protect-data-model-'));
    listed = project('listed', [
      `- Design: \`${ENTRY}\``,
      `- Included: \`${DESIGN}\` · sha256 \`aa\` · commit \`c8a6d1d\``,
      `- Included: \`${ADDENDUM}\` · sha256 \`bb\` · commit \`c8a6d1d\``,
    ]);
    single = project('single', [`- Design: \`${DESIGN}\` · sha256 \`aa\` · commit \`none\``]);
    unnamed = project('unnamed', ['- Template version: 1.4.0']);
  });

  afterAll(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  const edit = (root: string, file: string): string | undefined =>
    decide('Edit', { file_path: file }, root, root);
  const run = (command: string, cwd = listed): string | undefined =>
    decide('Bash', { command }, cwd, listed);

  it('denies Edit and Write on an included file, not on the entry file or a new addendum', () => {
    expect(edit(listed, DESIGN)).toBe('deny');
    expect(decide('Write', { file_path: `${listed}/${ADDENDUM}` }, listed, listed)).toBe('deny');
    expect(edit(listed, ENTRY)).toBeUndefined();
    expect(
      decide('Write', { file_path: `${listed}/${NEW_ADDENDUM}` }, listed, listed)
    ).toBeUndefined();
  });

  it('freezes the file on a lone Design line, and all of data-model/ when no design is named', () => {
    expect(edit(single, DESIGN)).toBe('deny');
    expect(edit(single, ENTRY)).toBeUndefined();
    expect(edit(unnamed, ENTRY)).toBe('deny');
  });

  it('denies redirections, tee, sed -i, truncate, dd and git checkout on an included file', () => {
    expect(run(`echo x >> ${ADDENDUM}`)).toBe('deny');
    expect(run(`cat > ${DESIGN} <<'EOF'\nx\nEOF`)).toBe('deny');
    expect(run(`printf x | tee -a ${ADDENDUM}`)).toBe('deny');
    expect(run(`sed -i 's/a/b/' ${ADDENDUM}`)).toBe('deny');
    expect(run(`sed -E -i.bak 's/a/b/' ${listed}/${ADDENDUM}`)).toBe('deny');
    expect(run(`truncate -s 0 ${ADDENDUM}`)).toBe('deny');
    expect(run(`dd if=/dev/zero of=${ADDENDUM} count=1`)).toBe('deny');
    expect(run(`git checkout HEAD~1 -- ${ADDENDUM}`)).toBe('deny');
  });

  it('follows cd, the working directory, globs, variables, find and xargs', () => {
    const base = 'modele-donnees-livraisons-v16-addendum.md';
    expect(run(`cd data-model && sed -i 's/a/b/' ${base}`)).toBe('deny');
    expect(run(`sed -i 's/a/b/' ${base}`, `${listed}/data-model`)).toBe('deny');
    expect(run("sed -i 's/a/b/' data-model/*.md")).toBe('deny');
    expect(run(`F=${ADDENDUM}; sed -i 's/a/b/' "$F"`)).toBe('deny');
    expect(run("find data-model -name '*.md' -exec sed -i 's/a/b/' {} +")).toBe('deny');
    expect(run("ls data-model/*.md | xargs sed -i 's/a/b/'")).toBe('deny');
    expect(run("find data-model -name '*.md' -delete")).toBe('deny');
  });

  it('skips here-document bodies, so a quote in one hides no later write', () => {
    expect(run(`cat > /tmp/notes.md <<'EOF'\nsed -i 's/a/b/' ${ADDENDUM}\nEOF`)).toBeUndefined();
    expect(run(`cat > /tmp/notes.md <<'EOF'\nl'addendum\nEOF\nsed -i 's/a/b/' ${ADDENDUM}`)).toBe(
      'deny'
    );
  });

  it('decides at once on a long glob', () => {
    expect(run(`sed -i 's/a/b/' data-model/${'*e'.repeat(40)}x ${ADDENDUM}`)).toBe('deny');
  });

  it('allows reads of included files and writes to files that are not frozen', () => {
    expect(run(`grep -n '^## ' ${ADDENDUM} > /tmp/headings.txt 2>&1`)).toBeUndefined();
    expect(run(`sed -n '1,20p' ${DESIGN} | tee "$OUT/part.md"`)).toBeUndefined();
    expect(run(`echo '<!-- include: x.md -->' >> ${ENTRY}`)).toBeUndefined();
    expect(run(`cat > ${NEW_ADDENDUM} <<'EOF'\n# A9\nEOF`)).toBeUndefined();
    expect(run(`git diff -- ${DESIGN} && git checkout main`)).toBeUndefined();
    expect(
      run(`python3 $SKILL/scripts/check_input.py ${ENTRY} --out docs/stories 2>&1 | tail -5`)
    ).toBeUndefined();
  });
});
