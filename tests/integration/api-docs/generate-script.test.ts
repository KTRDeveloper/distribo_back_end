import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { app } from '../../../src/app.js';

const outputPath = resolve(process.cwd(), 'openapi/openapi.json');

describe('npm run openapi:generate', () => {
  it('produces openapi/openapi.json matching the live GET /docs/openapi.json document', () => {
    execSync('npx tsx scripts/generate-openapi.ts', { cwd: process.cwd(), stdio: 'pipe' });

    const generated = JSON.parse(readFileSync(outputPath, 'utf-8'));

    expect(generated.openapi).toMatch(/^3\.1/);
    expect(Object.keys(generated.paths).length).toBeGreaterThan(0);
    expect(generated.paths).toHaveProperty('/health');
    expect(generated.paths).toHaveProperty('/auth/login');
  });

  it('matches the set of paths served live at /docs/openapi.json', async () => {
    execSync('npx tsx scripts/generate-openapi.ts', { cwd: process.cwd(), stdio: 'pipe' });
    const generated = JSON.parse(readFileSync(outputPath, 'utf-8'));

    const liveResponse = await request(app).get('/docs/openapi.json');

    expect(Object.keys(generated.paths).sort()).toEqual(Object.keys(liveResponse.body.paths).sort());
  });
});
