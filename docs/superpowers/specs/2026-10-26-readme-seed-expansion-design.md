# README and Demo Seed Expansion Design

## Goal

Make the root README a comprehensive project guide without project-progress reporting, and expand the synthetic demo dataset so the seed command can add representative data to both empty and populated databases.

## README

Rewrite `README.md` using the report, project context, and technology plan as sources. Cover the problem and goals, user groups, project scope and key workflows, traceable requirement/use-case groups, service architecture and data ownership, technology choices, privacy and AI boundaries, repository layout, and local setup. Link to the report and detailed technical guides for full specifications.

Remove progress, test-result, implementation-completion, and outstanding-work statements. Keep stable project constraints such as in-kind donations, synthetic demo data, Vietnamese product copy, and human authority over verification, priority, and dispatch. Describe requirements and design choices as project scope, not as claims that all behavior or acceptance evidence is complete.

## Seed data

Expand campaign fixtures from two to eight, covering the existing demo regions and an added synthetic region. Include varied campaign statuses and relative dates so public and internal campaign views have useful examples.

Add deterministic, synthetic fixture rows across the three owned databases:

- Identity: a small number of extra demo users, their memberships/grants, and region/organization support.
- Response: additional teams, positions, skills, and SOS requests linked to the demo regions and campaigns.
- Logistics: additional catalog/warehouse support, an open donation drive, donor declarations, and representative stock/fulfillment records where their ledger relationships can be maintained.

Put the additional rows in focused per-service SQL fragments. Include those fragments from the full seed files, and execute the same fragments in the populated-database path. Use stable IDs, conflict-safe inserts, transactions, and prerequisite checks for optional child records. These fragments only insert; they do not update or delete existing records. Keep the full seed scripts' existing lifecycle updates and ledger assertions restricted to empty databases.

The seed command remains development-only, uses only synthetic values, and hashes the configured `SEED_PASSWORD` with Argon2id. It does not reset volumes or create another database, schema, Compose project, or helper service. Update the setup guide to document the new behavior.

## Implementation boundaries

- Do not change API contracts, migrations, or product behavior.
- Do not modify unrelated in-progress working-tree changes.
- Do not run the seed job against the shared primary databases as part of this task; update the seed behavior so the user can run it intentionally.
- Do not claim tests or database checks that were not run.

## Verification approach

Review the final diff for consistency with current service schemas, fixed-ID references, transaction boundaries, and insert-only behavior. Check SQL text for parseable statement structure and README links/headings. Do not reset or seed the current databases. Report any checks that were not run.
