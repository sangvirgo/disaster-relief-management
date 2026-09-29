# Agent guidance for C48

This workspace contains the **Emergency Response and Disaster Relief Management System** capstone project.

## Required reading

Before analysis, design, implementation, or further research, read:

1. [Project context](docs/c48-project-context.md): the assigned scope and deliverables consolidated from the project brief and DOCX outline.
2. [Technology and delivery plan](docs/c48-technology-and-delivery-plan.md): the primary English technical baseline, including framework/database comparisons, requirements, architecture, and delivery plan.
3. Appendix A of the plan: implementation invariants, unresolved design issues, research protocol, and session handoff instructions.
4. For file storage or AI work, read the plan's expanded Section 12 and [storage research](docs/c48-storage-research.md), including the distinction between MinIO Community and AIStor Free.

## Main scope

- Web/mobile workflows connecting citizens, volunteers/rescue teams, coordinators, operations managers, and administrators.
- GPS-based SOS/assistance requests; verification, prioritization, assignment, and progress updates.
- Campaigns, warehouses, vehicles, relief points, resource distribution, dashboards, and reports.
- SRS, SDD, test cases, installation instructions, user guide, and demonstration evidence.

## Working conventions

- Maintain project documentation, code identifiers, and technical contracts in English. Apply the mandatory Vietnamese language policy below to communication and all user-facing product content.
- Use the technical comparison in the plan to explain technology choices. Django/DRF is the selected baseline based on relational workflows, GeoDjango, integrated administration, and delivery effort compared with Spring Boot, NestJS, FastAPI, and Flask.
- Distinguish source requirements, design decisions, proposals, and unresolved policies. Detailed API contracts, providers, performance thresholds, retention, and some business rules remain open.
- Preserve UR/FR/NFR/UC/TC identifiers and maintain traceability as implementation progresses.
- Keep Web, Mobile, APIs, events, state transitions, authorization, and data ownership consistent.
- AI supports research and human-reviewed suggestions; it must not automatically prioritize or dispatch rescue operations.
- Verify time-sensitive dependency/provider facts against primary sources before implementation. Existing research dates do not establish current support or compatibility.
- Before context exhaustion, leave a handoff describing completed work, remaining work, decisions, checks actually run, and the next concrete task. Never include secrets.

## Mandatory Vietnamese language policy

- Match the language of the user's current message for progress updates, clarification questions, explanations, and final responses: Vietnamese for Vietnamese messages, English for English messages. An explicit request for another response language takes precedence. This conversational rule does not change the product-language rules below.
- All Web and Mobile user-facing content must be in Vietnamese: navigation, labels, buttons, forms, placeholders, validation, status descriptions, empty/loading/error states, dialogs, accessibility labels, notifications, and user-facing report/export headings.
- All backend human-readable responses must be in Vietnamese: success/error messages, validation and field errors, authentication/authorization messages, business-rule conflicts, upload errors, and notification/email/push content. Cover framework defaults and translate/sanitize third-party errors at the application boundary.
- Keep machine-readable contracts stable: API paths, JSON field names, error codes, enum values, event types, identifiers, and code symbols may remain English. Clients must branch on codes, never on Vietnamese message strings. Render enum/status labels in Vietnamese in the UI.
- AI explanations and summaries displayed to users must be Vietnamese. Keep internal rule/reason codes stable and map them to Vietnamese copy. Preserve user-entered content, names, and identifiers as submitted; do not silently translate them.
- Use proper Vietnamese Unicode and consistent terminology across Web, Mobile, and Backend. Technical documentation and source-code identifiers remain English; technical logs may use stable English codes but must not leak secrets or PII.
- Include Vietnamese-language checks for representative success, validation, authentication, permission, conflict, notification, and AI-output paths when verifying an implementation. Do not add English fallbacks to user-facing flows without an explicit change to this policy.
