# Flood SOS locality records

This additive fixture contains 107 flood SOS scenarios at the 107 places supplied by the project team, grouped into 11 regions. The descriptions read as incident reports, while `request_subject.information_source` records that they are reconstructed scenarios requiring field verification. They are **not verified current incidents**.

Every request starts as `SUBMITTED`, with `campaign_id = NULL`, `campaign_match_state = UNMATCHED`, no priority, and no assigned team. Coordinators can use the normal verification, priority, campaign association, and assignment workflow. The fixture uses deterministic IDs and tracking codes, so rerunning it is idempotent.

The locality list is in `backend/scripts/dev/flood-sos-locations-2026-11.tsv`. Approximate map pins are in `fixtures/flood-locality-pins-2026-11.csv`. Pins were checked against OpenStreetMap data through [Photon](https://photon.komoot.io/); only a few match a specific locality. Most represent a nearby area or administrative center, and their exact position must be confirmed before operational use. The public OpenStreetMap data is credited to [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).

Generate the SQL with `node backend/scripts/dev/generate-flood-sos-seed.mjs` from the repository root. Apply `seed-flood-localities-2026-11.sql` to the primary `c48_response` database through the existing PostgreSQL service. This script does not reset any database or change existing requests.
