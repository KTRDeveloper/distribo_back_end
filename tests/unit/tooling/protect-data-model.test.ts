import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

// The PreToolUse hook reads the tool call as JSON on stdin and prints a deny
// decision, or nothing to let the call through. It only does path arithmetic,
// so a fake project root is enough.
const HOOK = '.claude/hooks/protect-data-model.cjs';
const ROOT = '/repo';
const DESIGN = 'data-model/modele-donnees-livraisons-v10.md';

function decide(
  toolName: string,
  toolInput: Record<string, string>,
  cwd = ROOT
): string | undefined {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput, cwd }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
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
});
