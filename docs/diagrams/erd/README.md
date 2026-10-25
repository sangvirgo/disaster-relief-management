# Reliva Physical ERD Decomposition

These diagrams are decomposed views of the current physical schemas in `docs/backend/schema/`. The SQL files remain authoritative for columns, constraints, indexes, triggers, and migrations.

## Diagram set

| View | Tables | Preview | Editable Draw.io source |
|---|---:|---|---|
| Full physical model — all services | 65 | [SVG](c48-erd-physical-overall.svg) | [Draw.io](c48-erd-physical-overall.drawio) |
| Identity | 9 | [SVG](c48-erd-identity.svg) | [Draw.io](c48-erd-identity.drawio) |
| Response — requests and verification | 14 | [SVG](c48-erd-response-requests.svg) | [Draw.io](c48-erd-response-requests.drawio) |
| Response — teams and missions | 8 | [SVG](c48-erd-response-rescue.svg) | [Draw.io](c48-erd-response-rescue.drawio) |
| Logistics — donations and intake | 19 | [SVG](c48-erd-logistics-donations.svg) | [Draw.io](c48-erd-logistics-donations.drawio) |
| Logistics — needs and stock | 7 | [SVG](c48-erd-logistics-fulfillment.svg) | [Draw.io](c48-erd-logistics-fulfillment.drawio) |
| Logistics — distribution and handoff | 8 | [SVG](c48-erd-logistics-handoff.svg) | [Draw.io](c48-erd-logistics-handoff.drawio) |

The full physical model puts all 65 tables, columns, types, key markers, and local foreign keys on one wide page. Each relationship connects the FK side to its referenced table and shows cardinality inferred from nullability and uniqueness. The eight tables with no FK relationship (`audit_log`, `idempotency_record`, and service-local `notice`) sit in aligned, labeled rows; no relationship is invented for them. The six detail views cover the same inventory at a more readable scale: 9 Identity, 22 Response, and 34 Logistics tables. Gray boxes are same-service tables detailed on another page; their lines still represent local SQL foreign keys.

## Legend and scope

- `PK`: primary key; `FK`: non-null foreign key; `FK?`: nullable foreign key.
- `UK`: single-column unique key; `UK*`: column participates in a composite unique key.
- `REF`: identifier or polymorphic reference without a declared foreign key. Cross-service IDs are validated by the owning service/API where required.
- Each service owns a separate database. No cross-database foreign key or direct join is represented.
- Table and column names preserve their SQL identifiers. Diagram notes and headings are Vietnamese.

The diagrams omit index definitions, `CHECK` expressions, triggers, and full application-level rules. See the DDL and [schema review](../../backend/01-schema-review.md) for those details.
