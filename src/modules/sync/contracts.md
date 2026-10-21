# Negotiated-price pull contract

CAT-042 brings the customer-price pull forward to the variant contract specified by
SYNC-027. This changes the existing `/api/v1/sync/pull` response, not the database schema.

For `changes.customer_prices`, each `created` or `updated` row contains exactly:

- `id`: negotiated-price UUID.
- `customer_relationship_id`: owning relationship UUID.
- `product_variant_id`: the sellable variant UUID, not its parent product UUID.
- `price`: integer XAF amount.
- `set_at`: epoch milliseconds used as the creation date for classification.
- `server_updated_at`: epoch milliseconds of the server's last write.

`product_id` is no longer emitted, including alongside the variant field. Clients
consuming the old name must migrate their local price references to variants; product
and variant IDs are not generally interchangeable. There is no dual-field alias or
new endpoint version. This follows SYNC-027's explicit replacement contract.

Incremental filtering and deleted-ID lists are unchanged. A wire-name change does not
update existing rows' server timestamps, so an incremental pull alone does not replay
unchanged prices to migrate a client's cache. Client rollout must account for that;
this change does not trigger an automatic full pull or alter rights scope versions.

Visibility remains the supplier's OWNER/MANAGER/SELLER relationships and the customer's
own relationships; drivers receive no supplier-side negotiated prices. Pushes remain
refused by this adapter and are not made writable by the pull contract change.

The legacy database parent column remains mandatory until CAT-043. Test fixtures use
`seedCustomerPrice` to derive that parent from the variant; it is not a wire field.
