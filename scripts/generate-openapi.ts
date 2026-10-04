import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { generateOpenApiDocument } from '../src/lib/openapi/generator.js';

// Import side effects only: each module registers its routes/schemas with
// the shared registry (src/lib/openapi/registry.ts) as it loads.
import '../src/modules/health/health.openapi.js';
import '../src/modules/user/user.openapi.js';
import '../src/modules/tasks/tasks.openapi.js';
import '../src/modules/person/person.openapi.js';
import '../src/modules/auth/auth.openapi.js';
import '../src/modules/admin/admin.openapi.js';
import '../src/modules/notification/notification.openapi.js';
import '../src/modules/organization/organization.openapi.js';
import '../src/modules/relationship/relationship.openapi.js';
import '../src/modules/catalog/catalog.openapi.js';
import '../src/modules/order/order.openapi.js';
import '../src/modules/delivery/delivery.openapi.js';
import '../src/modules/finance/finance.openapi.js';
import '../src/modules/remote-config/remote-config.openapi.js';
import '../src/modules/sync/sync.openapi.js';
import '../src/modules/privacy/privacy.openapi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(__dirname, '../openapi/openapi.json');

const document = generateOpenApiDocument();

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(document, null, 2) + '\n', 'utf-8');

console.log(`OpenAPI document written to ${outputPath}`);
