import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const files = [
  'catalog/copy-prices',
  'catalog/customer-catalog',
  'catalog/edit-product',
  'catalog/list-remove-prices',
  'catalog/reference-price',
  'catalog/set-customer-price',
  'order/enter-order',
  'order/place-order',
  'order/place-purchase',
  'sync/pull-relationships',
  'sync/rights-change',
];

describe('Negotiated price fixtures', () => {
  it.each(files)('%s uses no product column for customer prices', (file) => {
    const path = new URL(`../../integration/${file}.test.ts`, import.meta.url);
    const source = ts.createSourceFile(
      path.pathname,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.ES2022,
      true
    );
    const legacyFields: string[] = [];

    function visit(node: ts.Node, inPriceQuery = false): void {
      const priceQuery =
        inPriceQuery ||
        (ts.isCallExpression(node) &&
          node.expression.getText(source).startsWith('prisma.customerPrice.'));

      if (
        priceQuery &&
        (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
        node.name.getText(source) === 'productId'
      ) {
        legacyFields.push(node.getText(source));
      }

      if (
        ts.isTaggedTemplateExpression(node) &&
        /\bcustomer_prices\b/i.test(node.template.getText(source)) &&
        /\bproduct_id\b/.test(node.template.getText(source))
      ) {
        legacyFields.push(node.template.getText(source));
      }

      // Sync price payloads and expectations are identified by their relationship field.
      if (
        ts.isObjectLiteralExpression(node) &&
        node.properties.some(
          (property) => property.name?.getText(source) === 'customer_relationship_id'
        )
      ) {
        for (const property of node.properties) {
          if (property.name?.getText(source) === 'product_id') {
            legacyFields.push(property.getText(source));
          }
        }
      }

      ts.forEachChild(node, (child) => visit(child, priceQuery));
    }

    visit(source);
    expect(legacyFields).toEqual([]);
  });
});
