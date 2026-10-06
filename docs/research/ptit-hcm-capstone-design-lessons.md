# PTIT Ho Chi Minh City capstone design references

Research date: 2026-10-06. Scope: public graduation-project material useful for C48 requirements, architecture, UML, database design and UI documentation. This note informs report preparation; it changes no approved C48 scope, stack or business rule.

## Evidence and selection

Two attributable graduation projects were found. One has a full public report; the other has student-linked repositories and design/demo assets, with no full thesis reviewed. Four practical reading items are listed below. Multiple repositories belonging to the same project are not independent capstones. No grade, ranking, institutional endorsement or production readiness is inferred.

| Item | Provenance and period | Material actually examined |
|---|---|---|
| Nguyễn Thành Phong, **Xây dựng ứng dụng Android hỗ trợ bệnh nhân đăng ký khám và điều trị bệnh** | Report identifies N18DCCN147, class D18CQCP02-N, supervisor Nguyễn Anh Hào; acknowledgments name PTIT Ho Chi Minh City and Faculty of IT 2. Cover says 2023; student README records defense on 2022-12-26. These dates describe different artifacts. | [Final report PDF](https://raw.githubusercontent.com/Phong-Kaster/PTIT-Do-An-Tot-Nghiep/main/api/document/CP_147_NguyenThanhPhong.pdf): 134 PDF pages. Read cover, contents, workflow/architecture/use-case sections, selected dictionaries, ERD, dashboard section and conclusion. Visually inspected printed pages 10, 12, 68 and 74; PDF pages 23, 25, 81 and 87. Not a complete security or code audit. |
| Same project: API documentation | Student-authored supporting deliverable, same cohort/project. | [API README](https://github.com/Phong-Kaster/PTIT-Do-An-Tot-Nghiep/blob/main/api/document/README.md): introduction, method/routing conventions, role-specific Postman variables, login request fields. [Main repository](https://github.com/Phong-Kaster/PTIT-Do-An-Tot-Nghiep) links API, doctor Web and patient Android. |
| Same project: Web/Android documentation and report outline | Same capstone. Student says the outline was supplied by the supervisor; this is a student-hosted copy, not a verified current faculty-wide template. | [Doctor Web README](https://github.com/Phong-Kaster/PTIT-Do-An-Tot-Nghiep-Website), [Android README](https://github.com/Phong-Kaster/PTIT-Do-An-Tot-Nghiep-Android), and [report outline](https://github.com/Phong-Kaster/PTIT-Do-An-Tot-Nghiep/blob/main/api/document/Noi%20dung%20quyen%20bao%20cao%20do%20an.txt). Read relevant topic, database, dashboard, appointment, navigation and outline sections. |
| Nguyễn Tấn Phúc / Phuc–Linh team, **NutriAI / Lucfin Nutrition Assistant** | [Student LinkedIn account](https://vn.linkedin.com/in/ph%C3%BAc-nguy%E1%BB%85n-8b80302a9) explicitly describes a graduation thesis at PTIT-HCM and E21 classmates, linking the repositories through `lnkd.in/ggD9iiVm` and `lnkd.in/gY-bfGUW`. Public intermediate pages resolve to Phuc75nguyen's repositories. A reviewed screenshot is dated 2025-12-19; exact defense date/year was not independently established. | Read [Lucfin README](https://github.com/Phuc75nguyen/LucfinChatbot/blob/main/README.md) and [NutriAI README](https://github.com/Phuc75nguyen/NutriAI/blob/main/README.md), downloaded from their public raw URLs. Visually inspected the [architecture image](https://github.com/Phuc75nguyen/LucfinChatbot/blob/main/images/adative_architectureRAG.png) and [dashboard screenshot](https://github.com/Phuc75nguyen/NutriAI/blob/main/images/dashboard.png). No final report/SRS/ERD or executed evaluation was reviewed. |

For the first project, the repository tree examined was at commit `c925b6f2b2353e37f2c8f3fc9aeb001b355914f7`. Its PDF metadata gives creation/modification date 2023-01-05. Mutable `main` links are convenient reading links; later content can differ.

## What the first report teaches

The report connects business context to workflow, architecture, actor/use cases, data dictionaries and separate Web/API/Android design chapters. Its use-case tables include actors, preconditions, triggers, main steps and exceptions. The database figure uses table boxes, field types and relationship notation; the dashboard is accompanied by an explanation of what it measures. These observations come from the report sections/pages identified above. [Final report](https://raw.githubusercontent.com/Phong-Kaster/PTIT-Do-An-Tot-Nghiep/main/api/document/CP_147_NguyenThanhPhong.pdf)

The student also documents conflicting interpretations of appointment booking and a difference between normalized prototype diagrams and the implemented database. This is useful evidence of the need to settle concepts before implementation, rather than a reason to copy either model. [Main README — Topic and Database](https://github.com/Phong-Kaster/PTIT-Do-An-Tot-Nghiep#topic)

### Diagram review and C48 recommendations

The following assessments are this researcher's observations and recommendations, not the university's marking criteria.

| Reviewed figure | Useful quality | Limitation to avoid in C48 | Concrete adaptation |
|---|---|---|---|
| Physical architecture, printed p.10 / PDF p.23 | Patient mobile, hospital workstations and server/API are visible; arrows have numbered processing descriptions. | Hardware/context and software/API concepts share one figure; a reader cannot infer deployment units, trust boundaries or database ownership from it. | Keep the C48 system overview and container view separate. Label browser/mobile → Nginx → Identity/Response/Logistics, owned stores and REST connections; put a numbered SOS exchange in a separate sequence. |
| General use cases, printed p.12 / PDF p.25 | Patient, doctor and support-worker responsibilities are recognizable; use cases use ellipses and accompany prose. | No explicit software system boundary is shown. Arrowed associations and a hospital graphic receiving all links obscure whether it represents an actor, organization or system. | Put C48 actors outside a named boundary and use solid associations. Use separate readable actor views for response, donations and management; do not turn the system or warehouse icon into an actor. |
| Database, printed p.68 / PDF p.81 | Named tables and foreign-key relations make data structure concrete. | This is a detailed database diagram, not a conceptual domain model. The printed booking dictionary on p.62 contains reporter and patient snapshots that differ from fields visible in the p.68 figure. The README itself warns about prototype/implementation variants. | Keep conceptual min/max relationships separate from service-owned logical ERDs. Reconcile every diagram with its dictionary/migration. Explicitly distinguish reporter account, reporter contact and affected household; no victim account requirement for PROXY. |
| Dashboard, printed p.74 / PDF p.87 | The figure is explained by a nearby list of quantities and time periods. | The screenshot contains English labels and contact columns; it is not evidence of C48-compatible localization/privacy. | Explain every C48 dashboard count, filter and source time; include empty/unavailable states. Use Vietnamese headings and scoped access; aggregate heatmap responses exclude contacts and exact households. |

The dictionaries also use textual dates and inconsistent phone field types (for example, appointment phone is listed as `Int` on p.63). That is a report/schema quality issue to check, not proof about the running program. C48 should record phone identifiers as text, timestamps with explicit semantics, and typed coordinates/units under its existing plan. [Report, Chapter 4](https://raw.githubusercontent.com/Phong-Kaster/PTIT-Do-An-Tot-Nghiep/main/api/document/CP_147_NguyenThanhPhong.pdf)

## Useful report and API structure

The student-hosted outline distinguishes business use cases from supporting software functions, calls for parameterized sequence messages, and connects each form to backend APIs and database constraints. It also requests completed/uncompleted requirements and references. Treat it as historical supervisor guidance; confirm the current submission template separately. [Outline copy](https://github.com/Phong-Kaster/PTIT-Do-An-Tot-Nghiep/blob/main/api/document/Noi%20dung%20quyen%20bao%20cao%20do%20an.txt)

C48 can apply that structure without adding more systems:

1. For UC-01/15, show the citizen/reporter, subject location and server ACK; then document validation, failed GPS, lost response and retry separately.
2. For UC-02/03, show human verification, team candidate comparison and offer/accept/progress sequence; tie it to FR-REQ and FR-MSN IDs.
3. For UC-11/12, show guest declaration → independent count → independent approval → accepted stock, preserving declaration/count discrepancies.
4. Link every form to its OpenAPI operation, owning logical entity and acceptance case. Use the existing UR/FR/UC/TC identifiers; API examples are not executed test results.
5. Separate business actor views from supporting authentication/admin views. The historical outline's omission of login/admin in one business diagram is not authority to omit C48's required authentication and administrator scope.

The API documentation illustrates a useful purpose/method/URL/headers/body/response format. It is a manual reference, not evidence of complete OpenAPI schemas or authorization verification. C48 should use its planned OpenAPI contracts, stable error codes and Vietnamese human-readable errors. [API documentation](https://github.com/Phong-Kaster/PTIT-Do-An-Tot-Nghiep/blob/main/api/document/README.md)

## NutriAI: a second, narrower reference

The reviewed architecture groups client, orchestration, processing and knowledge/model components. Its screenshot pairs a source image, detection overlays, timestamp and generated summary. These are useful presentation ideas when explaining an optional AI path. [Architecture figure](https://github.com/Phuc75nguyen/LucfinChatbot/blob/main/images/adative_architectureRAG.png), [dashboard](https://github.com/Phuc75nguyen/NutriAI/blob/main/images/dashboard.png)

There are visible documentation limitations: the README says a three-layer pipeline while the figure labels four layers; the Android README names different YOLO generations in different sections. Its published metrics are author-reported and were not reproduced. A screenshot cannot establish accuracy, and model outputs should not be presented as certain facts merely because a figure labels a path “Objective Truth.” [Lucfin README](https://github.com/Phuc75nguyen/LucfinChatbot/blob/main/README.md), [NutriAI README](https://github.com/Phuc75nguyen/NutriAI/blob/main/README.md)

For C48, the transferable lesson is to show evidence, provenance, time, uncertainty and human review together. Do not adopt its Python/FastAPI, vector store or AI routing architecture: C48 retains NestJS/TypeScript and its optional advisor cannot verify, prioritize or dispatch automatically. Its mixed English/Vietnamese screenshot also does not meet C48's product language policy.

## Limits and next use

Official PTIT-HCM pages identify graduation study separately from coursework, but no current institution-wide SRS/SDD assessment rubric or public full-report archive was established in this search. [Official IT program description](https://fit.ptithcm.edu.vn/tuyen-sinh-2026/nganh-cong-nghe-thong-tin)

Course repositories such as [distributed-database materials management](https://github.com/haydxxn/QuanLyVatTu_CSDLPT_PTITHCM) describe a course project; they were not counted as graduation capstones or reviewed for design lessons. Other generic PTIT/Hanoi results were excluded when HCM provenance was absent. The search does not establish that public reports from other years do not exist.

No student code was run, no dependencies installed, no model metrics reproduced, and no contact/login action taken. The final report was extracted with `pdftotext`; four pages were rendered with `pdftoppm` and inspected. Two NutriAI images and the public README/outline files were read. Temporary downloads remained in `/tmp`; source reports and screenshots were not copied into the repository.

Next concrete use: review C48 diagrams against the architecture/UML/ERD pitfalls above, then prepare one SDD walkthrough connecting UC-15 → screen → API → Response entity → TC-REV-01..04. The current C48 plan remains the governing baseline.
