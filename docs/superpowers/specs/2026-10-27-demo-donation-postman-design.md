# Usable Seeded Donation for Postman

## Goal

Make the existing public in-kind donation fixture usable in the existing Postman collection so the donor can track and claim it with a matching capability secret. Reuse fixture `GD7K2N01`; do not create another donation row or add Postman requests.

## Seed behavior

- Keep the fixture's existing ID, public code, drive, item, declaration, and version.
- Replace its placeholder `donation_delivery.capability_hash` with the hash for the fixed local-demo secret, using the configured `SECRET_HASH_PEPPER_DONATION`, the existing `donation-delivery` purpose, and the current `v1:<hex>` format.
- Have `backend/scripts/db/seed.mjs` calculate the HMAC with Node's built-in crypto module and substitute the resulting hash into the existing Logistics seed SQL; no third-party hash dependency is needed.
- Allow only `donation_delivery.capability_hash` for this fixture to change, and only when its current value exactly matches `demo-capability-hash-seed-11`. A claim or recovery changes or clears that hash, so a later seed run must leave it untouched and must never restore the old secret.
- Supply the donation pepper to the declared seed job and validate it using the same length bounds as the Logistics API. Do not add a container, database, schema, Compose file, migration, or API endpoint.

This is a narrowly authorized exception to the existing seed-expansion rule that fixture fragments only insert: no other fixture fields or rows may be updated by this change.

## Postman collection

- Fill the collection's existing donation variables with fixture `GD7K2N01`'s ID, public code, drive ID, item ID, declaration version, and matching local-demo secret.
- Use the fixed fixture references: ID `00000000-0000-4000-8000-0000000a7011`, public code `GD7K2N01`, drive ID `00000000-0000-4000-8000-0000000a6010`, item ID `00000000-0000-4000-8000-0000000a1010`, and declaration version `1`.
- Keep all existing request entries and operation IDs. Do not add duplicate requests or expose any `/internal/` route.
- Keep the secret clearly documented as local demo data; it must not be used against a non-demo environment.

## Verification

- Add checks that the seed fragment updates only the fixture hash when it still equals the placeholder and that the collection's donation variables match the fixture and contain a syntactically valid capability secret.
- Verify the seed hash is derived from the configured pepper with the same purpose-bound HMAC format as Logistics.
- Run the focused backend script/unit checks and the existing public Postman donation flow where it does not consume or rotate the shared seeded capability. Do not run the seed job against the current primary databases or reset volumes for verification.
- Confirm the collection still contains only public routes and has no newly added request entries.

## Boundaries

- No API contract, authorization policy, production behavior, migration, or unrelated seed data changes.
- All data remains synthetic and local to the demo seed. Claim/recovery state is preserved on seed reruns.
