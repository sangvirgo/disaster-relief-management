# C48 Project Context: Emergency Response and Disaster Relief Management

> Context for AI agents and project members. This document consolidates the assigned requirements supplied in the conversation and the DOCX outline. Formatting and joined-word errors have been normalized while preserving source meaning. It describes the project brief, not a complete approved technical specification. The [technology and delivery plan](c48-technology-and-delivery-plan.md) separately records design decisions and open questions.

## 1. Project information

- **Project code:** C48
- **Original Vietnamese title:** Hệ thống quản lý ứng phó khẩn cấp và cứu trợ thiên tai
- **English title in the outline:** Emergency Response and Disaster Relief Management System
- **Product direction:** A Web/Mobile system connecting disaster-affected citizens, volunteers, rescue teams, coordination centers, and management authorities.
- **Expected duration in the outline:** 10 weeks

### Supplied team information

The following rows preserve the original information strings. The source does not clearly label the roles associated with each name or supervisor; do not infer those roles.

| Original information string | Class |
|---|---|
| Trương Thị Mỹ Ngọc · N22DCCN068 · Nguyễn Lưu Tấn Sang | D22CQCNPM01-N |
| Trương Thị Mỹ Ngọc · N22DCCN071 · Vũ Ngọc Sơn | D22CQCNPM01-N |
| Trương Thị Mỹ Ngọc · N22DCCN088 · Đỗ Xuân Trí | D22CQCNPM01-N |

## 2. Background and problem

Floods, storms, landslides, and other disasters affect citizens, local authorities, rescue personnel, and volunteer organizations. Relief information can be fragmented across channels, making it difficult to verify urgent requests, coordinate resources, assign rescue teams, and monitor progress.

The project proposes a centralized information system through which stakeholders receive and process SOS requests, coordinate rescue missions, manage relief resources, and track assistance distribution.

## 3. Objectives and business scope

### Objectives

- Receive GPS-based SOS/relief requests and incident information; the outline also mentions photo/video evidence.
- Help coordinators receive, verify, prioritize, and assign requests.
- Help volunteers/rescue teams accept missions, update status, and report outcomes.
- Manage warehouses, vehicles, relief points, and item distribution.
- Provide dashboards for relief campaigns and operational reports.
- Investigate AI-assisted priority suggestions or data analysis for decision support.

### User groups

1. **Citizen**
   - Register/sign in or submit an emergency request; the exact guest policy remains to be specified.
   - Send an SOS with location, incident type, and number of people needing assistance.
   - Track processing status and update the reported situation.

2. **Volunteer/Rescue Team**
   - Manage profiles, skills, and availability.
   - Receive rescue/relief missions and update progress.
   - Upload photos or evidence of mission completion.

3. **Coordinator**
   - Manage and verify relief requests.
   - Prioritize requests and assign rescue teams/volunteers.
   - Monitor progress on a map.

4. **Operations Manager**
   - Manage relief points, warehouses, and vehicles.
   - Coordinate resources across regions and manage relief campaigns.

5. **System Administrator**
   - Manage accounts and access permissions.
   - Monitor system activity and produce statistical reports.

## 4. Requirements and functions stated in the brief

The following restates source requirements for later conversion into User Requirements, Functional Requirements, and Non-functional Requirements in the SRS. This context does not assign requirement IDs or quantitative acceptance criteria; the technical plan supplies a proposed identified baseline.

### User Requirements

- Citizens need to submit SOS/assistance requests and understand their processing progress.
- Rescue teams/volunteers need to know assigned missions and report progress/outcomes.
- Coordinators need to verify, prioritize, assign, and monitor requests on a map.
- Operations managers need visibility into campaigns, stock, vehicles, relief points, and resource distribution.
- Administrators need to manage users, permissions, and operational statistics.

### Functional Requirements

- User authentication and role-based access control (RBAC).
- SOS/relief request creation, including incident type, affected-person count, GPS location, and available evidence files.
- Intake, verification, prioritization, assignment, and status updates for relief requests.
- Volunteer/rescue-team profiles, skills, and availability management.
- Mission management with assigned teams/people, progress, results, and completion evidence.
- Campaign, warehouse, vehicle, relief-point, and resource-distribution management.
- Map display of locations, requests, and missions for monitoring and coordination.
- Operational relief dashboards and statistical reports.
- File management and notifications as listed in the technical outline.
- Potential AI research for priority suggestions or data analysis; this is a proposed capability, not a confirmed mandatory feature.

### Non-functional Requirements

The outline identifies quality goals without specific acceptance thresholds:

- Web/mobile interfaces usable in emergency situations.
- Stability, security, and scalability.
- Operational traceability and transparency of relief distribution.
- Further definition of measurable performance, availability, security, location/file retention, and weak-connectivity behavior.

## 5. Architecture and technical direction in the outline

- A backend providing data-management services.
- A Web Application for Admin, Coordinator, and Manager roles.
- A Mobile Application for Citizen and Volunteer roles.
- System architecture, database, API, web interface, and mobile interface design.
- GPS data, authorization, resource management, and statistical reporting.
- Authentication, RBAC, file management, and notifications.

The original outline does not prescribe a language, framework, database, API protocol, map service, file storage, deployment platform, or offline synchronization mechanism. The technology plan evaluates alternatives and records the selected design baseline separately. Do not present those design choices as requirements from the original brief.

## 6. Required research and analysis

1. Analyze disaster-relief management and coordination problems in rescue workflows.
2. Study a centralized information system connecting citizens, volunteers, rescue teams, and management authorities.
3. Analyze User Requirements, Functional Requirements, and Non-functional Requirements.
4. Design Web App and Mobile App architecture for relief management.
5. Study GPS data management, authorization, resources, and statistical reporting.
6. Investigate AI support for prioritizing emergency situations.

## 7. Required products and deliverables

- A Web/Mobile disaster-relief management system.
- SOS submission, assistance-request creation, and rescue-status updates.
- Volunteer, rescue-team, and assigned-mission management modules.
- Dashboards for campaigns, warehouses, and resource distribution.
- Database, API, and interface design, plus system testing.
- SRS, SDD, test cases, and user documentation.
- Business analysis, actors/use cases/business rules, technical documentation, and demo/defense preparation as required by the outline.

## 8. Expected ten-week schedule

| Week | Work specified in the outline |
|---|---|
| 1 | Business research, requirements analysis, SRS, use cases, and database design. |
| 2 | UI/UX and system architecture design; development environment preparation. |
| 3–6 | Authentication/authorization, SOS/requests, rescue missions, volunteers, inventory/resources/relief points, dashboards, and maps. |
| 7 | Integration completion, system testing, and bug fixes. |
| 8 | Documentation, technical report, and demo preparation. |
| 9 | Product demonstration and capstone defense. |
| 10 | Contingency buffer. |

## 9. Evaluation criteria

- Correct understanding and modeling of disaster-response operations.
- Quality of system analysis and design.
- Completeness of the Web/Mobile Application.
- Stability, security, and scalability.
- UI/UX quality and user experience.
- Documentation, testing, and product presentation quality.

## 10. Principles for further requirements clarification

- Separate facts in the outline from proposed design decisions.
- Clarify workflows and each role's authority before detailed API/database design.
- Define SOS/request states, mission states, prioritization, verification, cancellation, and duplicate-handling rules.
- Clarify GPS capture timing, accuracy, updates, privacy, and offline behavior.
- Define inventory, transfers, and distribution records so reports can be reconciled with operational history.
- Establish measurable acceptance criteria for non-functional requirements.
- Treat AI output as research/proposals until scope and human-review mechanisms are defined.

## 11. User-authorized extension — in-kind donations (2026-10-04)

This extension comes from the user's subsequent instructions, not the original department brief. Warehouse managers may open donation drives; citizens may donate supplies while signed in or as guests. Donors record quantities handed over, warehouse staff independently count and verify intake, and the system preserves discrepancies and supporting records for reconciliation. Accepted donations must be traceable through stock movements and relief distribution. The user authorized best-practice design choices and requested research into comparable applications; AI is included only where justified. Cash collection and payment processing were not requested.

Section 25 of the [technical plan](c48-technology-and-delivery-plan.md) defines the adopted design, requirements, permissions, data ownership, reconciliation controls, distribution handoffs, optional AI gates, and planned acceptance cases. Software provides accountability and investigation evidence; it does not prove or guarantee the absence of corruption.
