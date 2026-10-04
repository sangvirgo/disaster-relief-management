# Research: in-kind donation, reconciliation, and relief distribution patterns

**Research date:** 2026-10-04  
**Question:** Which existing humanitarian and inventory workflows should C48 adapt for public in-kind donations, verified warehouse intake, and traceable distribution?  
**Evidence:** Official platform documentation and humanitarian logistics guidance. Recommendations below are C48 design proposals, not Vietnamese operational regulations or proof that software prevents corruption.

## Documented patterns worth adapting

### Sahana Eden: commitments and verified logistics records

Eden Legacy's inventory blueprint describes separate send/receive records, receiving staff confirming quantities per item, printable waybills/received notices/donation certificates, and keeping original quantities when discrepancies cause adjustments. It also covers donations entering inventory without a preceding internal shipment and returns from distribution points. The page mixes implemented features and a To Do list; it does not establish that every listed feature is complete. [Official inventory blueprint](https://eden-legacy.sahanafoundation.org/wiki/BluePrint/Inventory)

Its historical Haiyan deployment describes donating resources against posted needs and filtering donation opportunities geographically. However, it says both that public access allows donations and that an unauthenticated donor is redirected to login. This is not reliable evidence of unrestricted guest donation support. [Official Haiyan deployment description](https://eden-legacy.sahanafoundation.org/wiki/Deployments/Philippines/Haiyan)

Eden ASP became the main branch in May 2025 and the Legacy branch is archived. These legacy records provide historical workflow ideas, not a recommendation to deploy the old codebase or introduce its runtime into C48. [Current Sahana project status](https://new.sahanafoundation.org/eden/)

**Adaptation:** publish structured needed items and units; distinguish a donor declaration from an independently counted receipt; preserve both quantities and evidence; provide a receipt and progress view. Keep donation drives separate from rescue campaigns and warehouse fulfillment commitments.

### Logistics Cluster / WFP: physical evidence and handoff documents

The Logistics Operational Guide recommends receiving advance consignment information, physically counting against the waybill, documenting shortages/damage, inspecting goods and expiry, and creating a goods received note. Damaged/expired goods should be rejected or segregated. Dispatch includes an authorized release order, a count, and a waybill identifying the cargo and handoff participants. [Goods flow management](https://log.logcluster.org/en/goods-flow-management)

The guide cross-references stock movement documents with stock records, requires documented authorized receipts/issues/transfers/adjustments, and discusses retaining donor-specific records for accountability. It calls for signed evidence along the supply chain and copies for delivering and receiving parties. [Systematic recording and supporting documentation](https://log.logcluster.org/en/systematic-recording-and-support-documentation)

Goods received notes standardize incoming records and can substitute for missing or incomplete waybills; records should identify dates, locations, participants and contents. [Warehousing documentation](https://log.logcluster.org/en/warehousing-documentation)

**Adaptation:** issue immutable references for receipts, stock movements, dispatches, and delivery confirmations. Store accepted, rejected and physically held disputed quantities separately. Stock available for allocation comes only from authorized accepted intake. Reconcile quantity and condition at each custody change, not only when first entering the warehouse.

### IFRC: requested items and quality, not donation volume alone

IFRC's Green Logistics Guide recommends accepting donations that meet a specific need and quality standards, considering storage/transport/disposal costs, and checking upcoming expiry. It recommends visibility into donated, damaged and expired stock. [IFRC Green Logistics Guide](https://www.ifrc.org/sites/default/files/2024-02/20231214_GreenResponse_Logistics.pdf)

**Adaptation:** each donation drive states item specifications, canonical units, quality/expiry acceptance criteria, intake location and dates. Show promised and actually accepted quantities separately. Do not present pledged quantities as warehouse stock or successful aid deliveries.

### Odoo: batch traceability without treating each donation as a new product

Odoo's versioned documentation describes assigning lots on receipts and selecting existing lots on outgoing shipments. Lots support tracing batches and expiry/recall use cases; a tracked product needs its lot before receipt validation. [Official Odoo 18 lot documentation](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/product_tracking/lots.html)

**Adaptation:** reuse the existing item catalog; attach a source receipt/batch identifier to accepted quantities and downstream movement allocations. Preserve links through transfers, issues, returns and delivery settlements. Barcode scanning is an optional input aid, not evidence of count accuracy. No Odoo dependency or per-piece serial tracking is needed for ordinary donated supplies.

## C48 decisions supported by these patterns

These are proposed controls derived from the preceding evidence and the user's requested scope, not claims that the source platforms implement each exact control.

1. **Public intake:** a scoped warehouse manager opens a donation drive. Signed-in or guest donors submit item/quantity/unit declarations and receive a reference. A donor may separately record the amount actually handed over. Neither declaration can post stock. Delivering only part of a pledge does not imply misconduct.
2. **Independent counting:** intake staff record the observed amount, condition, accepted/rejected amounts and evidence without editing the donor's statement. Compare donor handed-over quantities with intake counts using canonical units; preserve dated revisions and the original snapshot. Missing donor handoff confirmation remains explicitly unverified.
3. **Discrepancy review:** any quantity/condition discrepancy, complaint, or later adjustment creates a review record with reason and supporting evidence. A different authorized reviewer from the intake actor decides the result; prohibit self-approval even if one person holds several roles. Authorize stock posting atomically and once. Physically held unresolved goods remain segregated and unavailable.
4. **Transparent receipt:** donors can inspect their declaration, actual verified receipt, discrepancy status and sanitized distribution progress. Provide an explicit dispute action. Donor confirmation supplements physical verification; lack of response does not prove acceptance or consent. Corrections use compensating ledger entries and reviewed reasons rather than editing posted history.
5. **Delivery accountability:** existing relief needs/commitments authorize allocations; dispatch documents identify issued quantities, source receipt/batch allocations, destination and custodian. A separate receiving party confirms delivery where practicable; differences settle as return, loss, rejection or outstanding custody. Issue is not delivery, and delivery to a relief point is not individual beneficiary handout. Label the recorded handoff accurately.
6. **Conservation report:** report donor-declared, physically counted, accepted, rejected, held, available, reserved, issued/in-transit, delivered, returned and lost quantities with their different meanings. Do not combine pledges and on-hand stock into a single total. Show source allocation rather than claiming identifiable physical objects when batches are mixed.

## Guest tracking and privacy

Guest donation is an explicit C48 feature. Reuse the plan's guest SOS capability pattern with a **separate donation purpose and scope**: a cryptographically random secret, hashed server storage, rate limits, object-limited access, and no privileged inventory commands. A public receipt number or QR containing that number is not authorization. Access secrets must not appear in public exports, logs, analytics or donor-recognition pages. Default public reporting to item totals and broad destinations; keep phone numbers, exact recipient details and evidence private. Lost-secret recovery must require ownership proof or staff review, not a searchable public donor list.

OWASP recommends random sufficiently long tokens, secure storage and rate limiting for password-recovery secrets. These security properties inform the C48 capability design; the source's single-use password-reset lifecycle is not copied to a recurring donation tracking token. [OWASP recovery token guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)

## AI decision

**Core reconciliation and distribution do not require AI.** Exact unit-normalized comparisons, immutable documents, approval permissions, stock constraints and conservation checks provide deterministic results that can be explained and tested. A discrepancy is an investigation signal, not proof of bribery or theft.

Optional later research may evaluate OCR to prefill a photographed delivery note, item-name suggestions, or anomaly ranking when real operating volume and independently reviewed cases justify them. Show source evidence and confidence; humans validate every extracted number. Never let AI approve intake, rewrite ledger history, accuse a person, change aid eligibility/priority, allocate stock or dispatch aid. No external model receives donor/recipient PII without an approved basis. Until a measured baseline shows benefit, keep AI disabled and use existing rules; optional research must not delay the core donation-to-delivery flow.

## Limits and next concrete validation

The reviewed sources do not establish Vietnamese charitable fundraising compliance, authority-specific approval policy, fraud detection accuracy, or production capacity. C48 remains an in-kind tracking capstone with synthetic data; cash, payment processing, tax receipts, procurement accounting, and proof of corruption are outside this researched feature scope. Real deployment needs operational/legal policy review.

Before implementation, specify exact units and precision, receipt/batch allocation constraints, multi-delivery pledge handling, guest recovery, complaint deadlines, reviewer assignment and absence handling, plus planned acceptance cases for concurrent intake, duplicate retries, mismatched handoffs, self-approval, compensating adjustments, partial delivery/returns and privacy. These are design gates, not executed product tests.
