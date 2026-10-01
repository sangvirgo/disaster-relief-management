# Research: patterns from disaster-response platforms for C48

**Initial research:** 2026-09-30 · **Source recheck:** 2026-10-01
**Question:** What do real humanitarian/disaster-response platforms do in practice, and which workflows are worth adapting to C48?
**Scope:** Sahana Eden, Ushahidi, and KoboToolbox, using platform-owner documentation, repositories, and an IFRC case study. This note records the research evidence; the later revision of the C48 plan separately adopts a three-service baseline and selected workflow patterns.

## Findings

### Sahana Eden: requests, commitments, logistics, and shared resource visibility

Sahana's current project page says Eden ASP became the main branch in May 2025, with Eden Legacy archived. Eden ASP is now centered on beneficiary case management and is described as a foundation for professional implementation teams. Its current developer documentation identifies Python/web2py as its runtime, so C48 should borrow domain patterns only and keep its own NestJS/TypeScript baseline. [Sahana Eden project status](https://new.sahanafoundation.org/eden/), [current developer documentation](https://eden-asp.readthedocs.io/en/latest/)

An older Eden ShaRe use-case document describes a useful request-to-delivery flow: a request logger records a need, an approver verifies it, and it then becomes available for processing. A responding organization can commit to all or part of the people/items requested; cancellation adjusts the commitment totals, and the request is completed only after the real-world need is met. The document also describes filtering requests by location/category and tracking delivery. This is a documented ShaRe use case, not a claim that every Eden deployment uses this exact workflow. [ShaRe use cases](https://eden-legacy.sahanafoundation.org/wiki/BluePrint/ShaRe/UseCases)

Eden Legacy's logistics documentation separates item catalogs, inventories/warehouses and shipments, and requests/commitments. That separation is useful for keeping “requested,” “reserved/committed,” “issued,” and “delivered” quantities distinct in the business model. [Eden Legacy logistics modules](https://eden-legacy.sahanafoundation.org/wiki/DeveloperGuidelines/Logistics)

There is historical deployment evidence from IFRC. Sahana's case page describes a shared Resource Management System for National Societies to view one another's inventory, assets, staff, and volunteers, with resource and hazard information combined on maps and access controlled by organization. IFRC's 2024 case study says the system was used in Asia Pacific until 2016, then retired; it identifies funding for product upgrades and preference for newer tools as factors. This is evidence for the workflow and a caution that ongoing maintenance matters, not a recommendation to copy that deployment or stack. [Sahana's IFRC RMS case](https://sahanafoundation.org/deployments/resource-management-system-ifrc/), [IFRC digital products case study](https://digital.ifrc.org/sites/default/files/media/document/2024-06/collaborating-and-delivering-digital-products-and-solutions-at-the-ifrc-v4.pdf)

For deployment, Sahana's current documentation describes a production setup behind a front-end web server, while its Eden Legacy guide distinguishes packaged production releases from installing a development version for demos/UAT. Those are Sahana-specific operating instructions; they do not imply that C48 needs multiple physical servers. [Current deployment documentation](https://eden-asp.readthedocs.io/en/latest/deploy/), [Eden Legacy deployment guide](https://eden.sahanafoundation.org/wiki/Guidelines:Deployment)

### Ushahidi: structured intake, human review, map views, and team queues

Ushahidi's user manual describes reports (“posts”) arriving through configured sources such as the web, SMS, email, and Twitter. Its survey configuration controls fields and visibility; deployments can require review before publication, hide submitter details, and hide exact locations from viewers without edit permission. Its data view lets permitted staff triage a chronological queue, edit reports, place them under review, publish, archive, or apply bulk actions. [Data view and moderation](https://docs.ushahidi.com/platform-user-manual/5.-modes-for-visualizing-and-managing-data-on-your-deployment/5.2-data-mode), [survey review and privacy settings](https://docs.ushahidi.com/platform-user-manual/3.-configuring-your-deployment/3.3-surveys)

Ushahidi also documents filters and saved searches for working sets such as unstructured reports or posts under review. These support coordinator queues; the reviewed documentation does not establish automatic duplicate-candidate detection, so C48's nearby-report suggestions remain a separate proposal. [Filtering posts and saved searches](https://docs.ushahidi.com/platform-user-manual/legacy/6.-managing-data-in-your-deployment/6.2-filtering-posts), [saved searches](https://docs.ushahidi.com/platform-user-manual/7.-analysing-data-on-your-deployment/7.1-saved-searches)

The Ushahidi release repository documents a Docker Compose setup that exposes the service at the host's port 80 and includes backup instructions. Treat this as the repository's documented getting-started/release setup, not as evidence of production capacity or high availability. [Ushahidi Platform release instructions](https://github.com/ushahidi/platform-release)

### KoboToolbox: field assessments when connectivity is unreliable

KoboToolbox's current documentation says web forms can cache a form and queue submissions offline until reconnection. Its GPS forms support point, line, and area capture, with location accuracy recorded for geopoints. This makes Kobo useful for learning field-intake behavior when connectivity is unreliable, not a replacement for C48's request verification, rescue mission, or stock workflows. Treat offline submission as optional until field conditions make it a confirmed requirement. [Data collection and offline forms](https://support.kobotoolbox.org/data-collection-tools.html), [GPS collection and accuracy](https://support.kobotoolbox.org/collect_gps.html)

KoboToolbox offers public Global and EU servers, and its documentation also notes that some large organizations use private servers. This is one product's hosting model; C48 need not operate a separate data-collection platform to borrow the offline-submission pattern. [KoboToolbox account and server options](https://support.kobotoolbox.org/creating_account.html)

## Recommended C48 adaptation

**Best feature to borrow:** make a coordinator-facing **request-to-fulfillment board** that connects verified SOS requests to one or more missions and relief allocations, and shows partial completion honestly.

This recommendation combines documented patterns from the platforms above with C48's existing requirements; it is a proposal, not an additional approved requirement:

1. Keep new reports in an internal “awaiting verification” queue. A coordinator records the verification outcome and reason before the request is treated as confirmed. Provide filters for awaiting verification, verified/unassigned, active missions, partially fulfilled, and completed. Ushahidi documents review gates and saved team filters; C48 already requires verification and reasoned outcomes in FR-REQ-04.
2. Keep request status separate from mission status and stock movements. Let one request have multiple missions and separate assistance needs, and show each need as requested, committed/reserved, issued, and delivered. A request can remain open after one mission finishes or after partial delivery. This extends C48's existing FR-MSN-03 and FR-LOG-02..04; it follows ShaRe's documented partial-commitment/completion distinction.
3. Add a map view with authorized request, team, warehouse, and relief-point layers, and let the coordinator filter it by status, region, priority, and time. Sahana's historical IFRC RMS used maps to compare resource locations with hazards; C48 already specifies scoped map filtering in FR-REQ-06.
4. Keep the final verification and assignment with a human coordinator. If later interviews confirm unreliable connectivity is in scope, add offline draft-and-submit behavior as a separate, testable slice inspired by KoboToolbox; do not silently treat an offline draft as received before server acknowledgement.

For a clear demo, use one synthetic scenario: a verified request needs both rescue and supplies; a suitable available team is assigned by the coordinator; only part of the supplies is delivered; the request remains open with the outstanding amount visible; after the remaining need is confirmed, the request closes with an actor/time audit trail. Also demonstrate an unverified report hidden from broad audiences and a coordinator filter for “verified but unassigned.”

## Peer capstone catalogue scan

The project owner also provided `Danh sach thuc hien DATN DHCQ khoa 2022 tro ve truoc 28092026.xlsx`; only the `CNTT (167)` sheet was reviewed. Repeated student rows were grouped by project code, leaving 63 distinct group codes for this qualitative scan. About 19 descriptions mention microservices and three mention Kafka; only C03 clearly describes Kafka with an outbox/inbox/Saga pattern, for a high-concurrency ticket-sales problem. Other entries list tools or learning material without enough detail to establish an implemented broker or independently deployed services.

Several described project ideas offer useful outcome-focused inspiration: C37's delivery dispatch, C41's Smart TMS with multi-stop/GPS/delay/e-POD features, and C47's traffic-simulation comparison against a baseline. The catalogue does not prove that these features were implemented or measured. C48 adapts the transferable parts as a coordinator fulfillment board, visible delivery gaps, timestamps from verification through delivery, and a modest k6 API scenario. The ticket-sales architecture in C03 is not copied because its high-concurrency replay/fan-out workload is not established in C48.

This scan is a review of descriptions in the provided workbook, not a claim about those teams' implementation quality or results.

## What the research does not establish

- These products show operational patterns; their user guides do not establish a requirement for Kafka, a particular number of C48 services, or multiple physical hosts.
- A map pin or straight-line distance is not a road route or reliable ETA. The sources reviewed do not validate an automatic rescue-dispatch algorithm for C48.
- The older Eden ShaRe/IFRC material is valuable workflow evidence but is historical. The IFRC confirms its RMS was retired after 2016. Reuse the business ideas, not its unmaintained assumptions or runtime.
- C48 still needs stakeholder agreement on who can verify/close a request, what counts as completed aid, privacy for exact locations, and whether offline reporting is in scope. Humanitarian platform examples do not define Vietnamese authority policy.

## Sources

- [Sahana Eden current project page](https://new.sahanafoundation.org/eden/) and [developer documentation](https://eden-asp.readthedocs.io/en/latest/)
- [Sahana Eden Legacy ShaRe use cases](https://eden-legacy.sahanafoundation.org/wiki/BluePrint/ShaRe/UseCases) and [logistics modules](https://eden-legacy.sahanafoundation.org/wiki/DeveloperGuidelines/Logistics)
- [Sahana Foundation IFRC RMS deployment description](https://sahanafoundation.org/deployments/resource-management-system-ifrc/) and [IFRC 2024 case study](https://digital.ifrc.org/sites/default/files/media/document/2024-06/collaborating-and-delivering-digital-products-and-solutions-at-the-ifrc-v4.pdf)
- [Ushahidi user manual](https://docs.ushahidi.com/platform-user-manual), [release repository](https://github.com/ushahidi/platform-release)
- [KoboToolbox documentation](https://support.kobotoolbox.org/) and [UNHCR KoboToolbox guide](https://www.unhcr.org/handbooks/assessment/collect/kobotoolbox)
