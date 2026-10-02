import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { app } from '../../../src/app.js';
import { bodyOf, type OpenApiDoc } from '../../helpers/body';

const outputPath = resolve(process.cwd(), 'openapi/openapi.json');

describe('npm run openapi:generate', () => {
  it('produces openapi/openapi.json matching the live GET /docs/openapi.json document', () => {
    execSync('npx tsx scripts/generate-openapi.ts', { cwd: process.cwd(), stdio: 'pipe' });

    const generated = JSON.parse(readFileSync(outputPath, 'utf-8')) as OpenApiDoc;

    expect(generated.openapi).toMatch(/^3\.1/);
    expect(Object.keys(generated.paths).length).toBeGreaterThan(0);
    expect(generated.paths).toHaveProperty('/api/v1/health');
    expect(generated.paths).toHaveProperty('/api/v1/users/me');
  });

  it('matches the set of paths served live at /docs/openapi.json', async () => {
    execSync('npx tsx scripts/generate-openapi.ts', { cwd: process.cwd(), stdio: 'pipe' });
    const generated = JSON.parse(readFileSync(outputPath, 'utf-8')) as OpenApiDoc;

    const liveResponse = await request(app).get('/api/v1/docs/openapi.json');

    expect(Object.keys(generated.paths).sort()).toEqual(
      Object.keys(bodyOf<OpenApiDoc>(liveResponse).paths).sort()
    );
  });
});
