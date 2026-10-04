import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { bodyOf, type OpenApiDoc } from '../../helpers/body';

describe('GET /docs/openapi.json', () => {
  it('returns a valid OpenAPI document', async () => {
    const response = await request(app).get('/api/v1/docs/openapi.json');

    expect(response.status).toBe(200);
    const doc = bodyOf<OpenApiDoc>(response);
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(doc.info).toHaveProperty('title');
    expect(doc.paths).toBeTypeOf('object');
  });

  it('lists every current endpoint from every module', async () => {
    const response = await request(app).get('/api/v1/docs/openapi.json');
    const paths = Object.keys(bodyOf<OpenApiDoc>(response).paths);

    expect(paths).toContain('/api/v1/health');
    expect(paths).toContain('/api/v1/health/ready');
    expect(paths).toContain('/api/v1/health/live');

    expect(paths).toContain('/api/v1/users/me');

    expect(paths).toContain('/api/v1/tasks');
    expect(paths).toContain('/api/v1/tasks/{id}');

    expect(paths).toContain('/api/v1/remote-config');
    expect(paths).toContain('/api/v1/remote-config/{id}');
    expect(paths).toContain('/api/v1/remote-config/migrate');

    expect(paths).toContain('/api/v1/organizations');
    expect(paths).toContain('/api/v1/organizations/lookup');
    expect(paths).toContain('/api/v1/organizations/{organizationId}');
    expect(paths).toContain('/api/v1/organizations/{organizationId}/collaborators');
    expect(paths).toContain(
      '/api/v1/organizations/{organizationId}/collaborators/{collaborationId}'
    );
    expect(paths).toContain('/api/v1/organizations/{organizationId}/collaborators/me');
    expect(paths).toContain('/api/v1/organizations/{organizationId}/subscription');
    expect(paths).toContain('/api/v1/organizations/{organizationId}/transfer-ownership');
    expect(paths).toContain('/api/v1/organizations/{organizationId}/close');
    expect(paths).toContain('/api/v1/organizations/{organizationId}/reopen');
    expect(paths).toContain('/api/v1/organizations/{organizationId}/customers');
    expect(paths).toContain('/api/v1/organizations/{organizationId}/customers/{relationshipId}');
    expect(paths).toContain(
      '/api/v1/organizations/{organizationId}/customers/{relationshipId}/credit-limit'
    );
    expect(paths).toContain(
      '/api/v1/organizations/{organizationId}/customers/{relationshipId}/credit-limit-changes'
    );
    expect(paths).toContain(
      '/api/v1/organizations/{organizationId}/customers/{relationshipId}/end'
    );
    expect(paths).toContain(
      '/api/v1/organizations/{organizationId}/customers/{relationshipId}/reopen'
    );
    expect(paths).toContain('/api/v1/organizations/{organizationId}/counters');
    expect(paths).toContain('/api/v1/organizations/{organizationId}/suppliers');
    expect(paths).toContain('/api/v1/organizations/{organizationId}/suppliers/{relationshipId}');
    expect(paths).toContain('/api/v1/suppliers');
    expect(paths).toContain('/api/v1/suppliers/{relationshipId}');
    expect(paths).toContain('/api/v1/suppliers/{relationshipId}/end');
    expect(paths).toContain('/api/v1/suppliers/{relationshipId}/reopen');
    expect(paths).toContain('/api/v1/collaborations');
    expect(paths).toContain('/api/v1/collaborations/{id}/accept');
    expect(paths).toContain('/api/v1/collaborations/{id}/decline');

    // ADM-007: the recovery email routes
    expect(paths).toContain('/api/v1/admin/recovery-email/request');
    expect(paths).toContain('/api/v1/admin/recovery-email/confirm');

    // ADM-008: authenticator recovery through the recovery email
    expect(paths).toContain('/api/v1/admin/auth/totp-recovery/request');
    expect(paths).toContain('/api/v1/admin/auth/totp-recovery/confirm');

    // ADM-009: appointing an administrator
    expect(paths).toContain('/api/v1/admin/administrators');

    // ADM-010: removing an administrator
    expect(paths).toContain('/api/v1/admin/administrators/{administratorId}');

    // ADM-011: reporting a person or an organization
    expect(paths).toContain('/api/v1/reports');

    // ADM-012: moderators list and open reports
    expect(paths).toContain('/api/v1/admin/reports');
    expect(paths).toContain('/api/v1/admin/reports/{reportId}');

    // ADM-013: a moderator resolves a report
    expect(paths).toContain('/api/v1/admin/reports/{reportId}/resolve');

    // ADM-014: suspending or reactivating a person or an organization without a report
    expect(paths).toContain('/api/v1/admin/people/{personId}/suspend');
    expect(paths).toContain('/api/v1/admin/people/{personId}/reactivate');
    expect(paths).toContain('/api/v1/admin/organizations/{organizationId}/suspend');
    expect(paths).toContain('/api/v1/admin/organizations/{organizationId}/reactivate');

    // ADM-015: administrators read the action journal
    expect(paths).toContain('/api/v1/admin/actions');

    // AUTH-009/010/013: the auth paths are the registration code request, registration and login
    const authPaths = paths.filter((p) => p.startsWith('/api/v1/auth'));
    expect(authPaths.sort()).toEqual([
      '/api/v1/auth/devices',
      '/api/v1/auth/devices/{id}',
      '/api/v1/auth/email/verify/confirm',
      '/api/v1/auth/email/verify/request',
      '/api/v1/auth/login',
      '/api/v1/auth/login/verify',
      '/api/v1/auth/logout',
      '/api/v1/auth/logout-all',
      '/api/v1/auth/password-reset/confirm',
      '/api/v1/auth/password-reset/request',
      '/api/v1/auth/password/change',
      '/api/v1/auth/phone/change/confirm',
      '/api/v1/auth/phone/change/request',
      '/api/v1/auth/refresh',
      '/api/v1/auth/register',
      '/api/v1/auth/register/request',
    ]);
  });

  it('groups endpoints by feature-area tags', async () => {
    const response = await request(app).get('/api/v1/docs/openapi.json');
    const { paths } = bodyOf<OpenApiDoc>(response);

    expect(paths['/api/v1/health'].get.tags).toContain('health');
    expect(paths['/api/v1/users/me'].get.tags).toContain('user');
    expect(paths['/api/v1/tasks'].get.tags).toContain('tasks');
    expect(paths['/api/v1/remote-config'].get.tags).toContain('remote-config');
  });

  it('describes each endpoint with request/response schema details', async () => {
    const response = await request(app).get('/api/v1/docs/openapi.json');
    const usersOp = bodyOf<OpenApiDoc>(response).paths['/api/v1/users/me'].get;

    expect(usersOp.security).toBeDefined();
    expect(usersOp.responses?.['200']).toBeDefined();
  });
});
