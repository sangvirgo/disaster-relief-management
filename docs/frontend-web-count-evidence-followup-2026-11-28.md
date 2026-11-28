# Counting evidence and team candidate follow-up — 28 November 2026

## Scope and decisions

- The owner narrowed the upload request to the staff receipt-counting form and retained the existing five-file limit. Citizen SOS, donation declaration and donation evidence rules are unchanged. There are no Logistics API, storage, quota, schema or database changes for this upload fix.
- Receipt counting uses the SOS selection pattern: append multiple selections, deduplicate by name/size/last-modified, reject invalid metadata and reset the native input so a removed file can be selected again. Local image/video previews release object URLs when removed or unmounted.
- Uploads remain sequential, with a separate stable idempotency key per file. Successful files are retained across a count-command retry. A partial upload failure stops the count/confirmation command and displays per-file errors. An uncertain response is retried with its original key rather than creating duplicate attachments. This does not alter the existing backend storage-failure lifecycle.
- Pending file bytes are not persisted in session storage. Restored count drafts explicitly ask the operator to select evidence again.
- The outside-drive badge sits above its input row. Condition-note and expiry inputs align at the bottom and use the same 44px control height.

## Candidate pagination correction

Identity owns active-volunteer eligibility; Response owns active team membership. Response previously paged Identity results and then removed assigned people, exposing empty pages with a next cursor. It now fills a page from eligible, unassigned candidates and looks ahead before advertising a next page. Cursors retain the original Identity boundary so lookahead does not lose the next candidate. The shared admin/leader picker uses `more`, hides first-page empty pagination and explains that no matching unassigned volunteer exists.

## Verification

- Web unit tests: 80 passed, including append/deduplication, five-file limit, invalid selection, partial failure, stable retry keys and pending-storage handling.
- Web TypeScript/Vite build passed.
- Four related Identity/Response unit suites: 52 passed (24 membership tests), including assigned-only pages and continuation without skipping eligible candidates. OpenAPI contract checks passed for all 225 operations.
- Browser checks on localhost:5174: selected two images together; appended files up to five; duplicate selection did not duplicate an entry; sixth image was rejected; removed one image and added another; invalid text file was rejected; all five image previews decoded.
- Submitted the seeded GD7K2M04 independent count with five synthetic PNG fixtures. UI confirmed matching independent counts and stock posting; a read-only PostgreSQL check confirmed exactly five READY attachments and delivery status POSTED. This is local demo data only.
- Browser DOM measurements: condition and expiry inputs both 44px high at identical vertical positions. Outside-drive badge precedes the aligned quantity inputs.
- Leader picker: `vol` returned the two unassigned volunteers with no surplus pager; `citi` returned the Vietnamese empty state with no pager. No membership or grants were changed by these checks.
- Partial upload/network failure handling was exercised in unit tests, not fault-injected in the browser. No production service was changed.
