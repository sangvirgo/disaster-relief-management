# C48 Storage Research: MinIO, AIStor, and S3 Integration

| Attribute | Value |
|---|---|
| Research date | 2026-09-29 |
| Scope | Evidence photos/videos, private downloads, Django integration, storage operations |
| Related baseline | [Technology and delivery plan](c48-technology-and-delivery-plan.md), especially FR-FILE-01, NFR-SEC-02, NFR-PRV-01, NFR-OPS-01, TC-24, TC-29 |
| Status | Primary-source research and proposed design; no storage installation, compatibility test, or restore test was performed |

## 1. Recommendation

**MinIO can be used for the capstone, provided the edition is explicit.** The recommended MinIO path is a **conditional AIStor Free single-node lab deployment with synthetic data**, after checking current license terms, obtaining a valid license, and passing the integration checks below. It is not the default recommendation for a real disaster-response deployment.

The previous plan's archive warning applies to the open-source Community repository. It must not be generalized into a claim that every MinIO product is abandoned. AIStor is the vendor's current product line; its Free and paid editions have different operational and licensing conditions. [MinIO repository](https://github.com/minio/minio), [AIStor subscriptions](https://www.min.io/pricing)

Keep Django's storage integration S3-compatible so the capstone can also use SeaweedFS or a managed provider. Do not purchase a subscription, provision a cloud account, or silently accept a license as part of this research.

## 2. What changed, and which edition is meant?

| Option | Verified fact | Consequence for C48 |
|---|---|---|
| MinIO Community | Repository archived on 2026-04-25; README declares it unmaintained and describes source-only distribution | Old tutorial image tags are not an acceptable maintained baseline |
| MinIO AIStor Free | Vendor offers a no-cost single-node product under a proprietary agreement | Potentially suitable for a self-supported capstone lab; review actual feature entitlements |
| MinIO AIStor Enterprise Lite / Enterprise | Paid tiers offer distributed deployments; support differs by tier | Consider only if a later deployment needs paid capabilities and has a budget |

Sources: [Community status](https://github.com/minio/minio), [current product tiers](https://www.min.io/pricing), [Free agreement](https://www.min.io/legal/aistor-free-agreement).

The vendor legal page dates open-source end-of-life to September 2025 and says those downloads are no longer available from its distribution site. GitHub archiving happened later. These are different milestones. [MinIO legal center](https://www.min.io/legal)

### 2.1 Security and release caveats

The GitHub release list includes the source-oriented security release `RELEASE.2025-10-15T17-29-55Z`, addressing a service-account/STS session-policy bypass. Therefore, describing September 2025 as the final source tag would be inaccurate. [Community release history](https://github.com/minio/minio/releases), [session-policy advisory](https://github.com/minio/minio/security/advisories/GHSA-jjjj-jwhf-8rgr)

The April 2026 `ReadMultiple` path-traversal advisory lists affected Community releases through `RELEASE.2025-09-07T16-13-09Z` and recommends an AIStor upgrade. Its wording about the final Community release differs from the October tag above. Do not infer that the October source tag fixes later vulnerabilities without checking code/advisories. This research does not establish any Community build as secure. [Maintainer advisory](https://github.com/minio/minio/security/advisories/GHSA-xh8f-g2qw-gcm7)

**C48 decision:** avoid legacy Community images as the shared demo default. If studying Community historically, isolate it to disposable synthetic-data experiments and document the exact source revision; a reproducible build does not provide ongoing security maintenance. Do not use an unverified third-party rebuild as a substitute for support.

### 2.2 AIStor Free: conditions that matter

The Free agreement permits standalone, single-node use, including education and research. It prohibits modification and redistribution, among other restrictions. It is proprietary software, despite having no license fee. Distribute C48's configuration and setup instructions; do not bundle the AIStor binary/image or license in the repository or submission archive without establishing permission. These are source-reported terms, not a complete legal assessment. [AIStor Free agreement](https://www.min.io/legal/aistor-free-agreement)

The operational license documentation excludes distributed deployment, replication, lifecycle transitions, version-specific deletion, and encryption at rest from Free, and gives no SLA/SLO. It requires an active license; expiry may restrict access. Check the actual license's dates and recovery process before a demonstration. [AIStor license operations](https://docs.min.io/aistor/operations/licenses/)

The pricing page calls Free full-featured, while operational documentation lists exclusions. Use the specific operational restrictions when designing C48, then verify them on the selected release. Do not promise encryption, replication, or paid support from the Free tier. [Pricing](https://www.min.io/pricing), [license feature restrictions](https://docs.min.io/aistor/operations/licenses/)

For a lab, use synthetic images and an explicit single-node limitation. For a real pilot, reassess privacy requirements, storage encryption, resilience, support, and acceptable downtime before choosing an edition/provider.

### 2.3 Community licensing

Community source uses GNU AGPLv3. Its license text includes obligations concerning distribution and, for modified versions, remote network interaction. This note does not conclude that every application accessing MinIO over S3 must publish all its source, nor that capstone use is exempt from obligations. Record the precise edition and distribution model, preserve applicable notices, and review the actual license for the intended use. AIStor Free has a separate agreement. [Community license text](https://github.com/minio/minio/blob/master/LICENSE), [AIStor Free agreement](https://www.min.io/legal/aistor-free-agreement)

## 3. Fair comparison for this project

| Criterion | AIStor Free | SeaweedFS Community | Managed S3-compatible provider |
|---|---|---|---|
| Learning value | S3 objects, access policies, signed URLs, storage operations | Same application concepts; additional filer/volume architecture to understand | Application integration and cloud IAM; less host-storage administration |
| License/support | Proprietary Free terms; no contractual SLA | Apache-2.0 community software; no assumed vendor SLA | Provider agreement, selected plan, and service terms |
| Demo topology | One node; failure of host interrupts service | Single-host lab possible; distributed design requires more work | Provider hosts storage; demo depends on network/account availability |
| Security work owned by team | Credentials, policies, host/TLS, upgrades, license monitoring, backups | Credentials, policies, host/TLS, upgrades, backups | IAM, bucket policy, URL exposure, retention, account security; provider handles underlying infrastructure |
| Packaging | Avoid redistributing product artifacts without permission | Review license/notices when packaging | No server binary in capstone; account/secrets setup required |
| Data resilience | Do not assume Free replication or HA | Depends on configured topology and tested recovery | Depends on the selected service; cannot generalize across all S3-compatible providers |
| Best fit | Learning MinIO on a controlled capstone host | Open-source self-hosted fallback | Candidate for an approved real deployment after cost/privacy review |

SeaweedFS documents an Apache-2.0 license, an S3 endpoint, and a single-command lab mode. Its multi-component internals still need operational understanding; this research does not establish superior performance or full API equivalence. [SeaweedFS project](https://github.com/seaweedfs/seaweedfs)

**Selection rule:** start with AIStor Free if the team accepts its current terms and can obtain a working license and artifact; otherwise use SeaweedFS. Both must pass the same C48 application checks. Choose a managed provider only when hosting region, data rules, credentials, cost limits, and deployment scope are known.

## 4. Django integration boundary

Use `django-storages` with its boto3-backed `storages.backends.s3.S3Storage`, configured through Django `STORAGES`. Documented options include custom endpoint, region, signing, addressing style, query-string authentication, expiry, and overwrite behavior. [django-storages S3 backend](https://django-storages.readthedocs.io/en/latest/backends/amazon-S3.html)

No separate file microservice is needed. Response owns SOS/mission evidence metadata; Logistics owns its receipt/distribution attachments. Each calls storage using its own credentials and bucket. Identity, Reporting, Notification, and the AI worker receive no blanket bucket access.

Proposed deployment configuration, not validated code:

| Setting/convention | Proposed C48 value or rule |
|---|---|
| Storage backend | `storages.backends.s3.S3Storage` |
| Buckets | `c48-response-evidence` and `c48-logistics-evidence`; create only buckets used |
| Credentials | Distinct least-privilege service keys loaded from environment/secret storage; root credentials only for administration |
| Endpoint | Deployment-specific S3 API endpoint, never the management-console URL |
| Region | Explicit value matched to the chosen provider's signing behavior |
| Signature/addressing | Test SigV4 and path-style for the selected self-hosted provider; do not assume the same defaults everywhere |
| Public access | No anonymous read/list/write policy; verify the actual effective policy |
| Signed downloads | `querystring_auth=True`; short expiry such as 120 seconds is a proposal |
| Overwrite | Server-generated immutable UUID keys; avoid user-controlled object names |
| TLS | Verify certificates; HTTP only in an isolated local development environment |

The library's private defaults do not replace provider-side policy verification. A bucket policy can still expose an object. Keep any public static assets separate from sensitive uploads. [django-storages settings](https://django-storages.readthedocs.io/en/latest/backends/amazon-S3.html)

### 4.1 Metadata and ownership

Proposed `EvidenceMetadata` fields:

- UUID, owning request/mission/distribution ID, uploader's opaque user ID.
- Storage alias/provider, bucket, immutable object key, optional provider version ID.
- Original display filename, detected MIME, byte length, independent content checksum.
- Upload state, validation outcome, creation/validation timestamps, visibility scope.
- Deletion/reconciliation status and reason where required by the retention policy.

Store neither object bytes nor expiring signed URLs in PostgreSQL. Never assume S3 ETag is universally a content MD5, particularly for multipart uploads; define the checksum used for restore verification explicitly. [Amazon S3 object integrity](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html)

### 4.2 Start with backend-mediated uploads

For the first capstone slice, route uploads through the owning Django service. This centralizes authorization and validation and avoids a second upload-session protocol before it is needed. Configure request limits, temporary-disk limits, and timeouts; never load arbitrarily large videos into worker memory.

1. Accept and persist SOS independently of optional evidence; storage outage must not lose the SOS.
2. Authorize upload against the request/mission and current role/scope.
3. Create a short database transaction recording a PENDING attachment with a generated key; commit before network I/O.
4. Stream to controlled temporary storage, enforce byte limits, inspect content, and apply allowed type rules.
5. Upload validated bytes to the private bucket; record READY and audit history in another short transaction.
6. Return the attachment ID; only READY objects can receive download URLs.
7. On failure, expose FAILED/PENDING honestly. A reconciler cleans abandoned objects and repairs interrupted metadata transitions.

Use extension/type allowlists, generated filenames, content inspection, and size limits. Client MIME is untrusted; content checks alone are not a complete defense. Serve dangerous/unsupported formats as downloads or reject them according to the agreed policy. [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

Database rollback cannot undo an S3 upload. Do not hold row locks during upload, and do not claim an atomic transaction across PostgreSQL and storage. A failed attachment must not mark a mission as completed merely because bytes exist.

### 4.3 Direct upload is an optional later optimization

Add direct browser/mobile upload only when measured upload load justifies it. The owning service creates a scoped upload intent and issues a short-lived signed operation for one random quarantine key. The client then asks the service to finalize; the server checks actual size/content/checksum and ownership before marking READY.

Presigned URLs can be reused while valid, and upload to an existing key can replace the object. They are bearer capabilities, not automatically single-use permissions. [Amazon S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)

Therefore, do not finalize by trusting the client's success flag or merely inspecting a mutable key once. Bind the finalized metadata to a verified immutable version, or copy verified bytes to a distinct final key which the upload capability cannot overwrite. Reconcile abandoned uploads after an agreed grace period.

## 5. Browser/mobile reachability and download authorization

A common Compose integration failure is signing `http://minio:9000/...`: that hostname may resolve only inside Docker. On a physical phone, `localhost` refers to the phone. Define a client-reachable S3 hostname and test from both browser and device networks.

Proposed deployment choices:

- Prefer one stable HTTPS S3 hostname reachable from backend and clients, with DNS/routing configured for both.
- If internal and external endpoints differ, use a dedicated signing client configured for the external endpoint. Do not rewrite the URL after signing.
- Reverse proxies must preserve the signed request's host/path/query semantics. Configure browser CORS only for allowed app origins/methods when direct access requires it.
- Keep the management console restricted to operators; application users never log in to it.

An authorized download request checks the current business object, attachment READY state, and actor scope before creating a URL. Do not put signed URLs into Kafka, logs, analytics, email templates, or persistent report rows.

A previously issued URL can remain usable until expiry even after application permission changes. If immediate revocation on each read is required, proxy downloads through authenticated Django instead, accepting the bandwidth cost. Expiry and credential validity affect signed-URL lifetime. [Amazon S3 presigned access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)

## 6. Backup, restore, and provider migration

These are proposed C48 operations; no recovery has been demonstrated yet.

1. For the capstone, briefly quiesce uploads/deletions and drain attachment finalization before making a consistent backup checkpoint.
2. Back up owning-service databases, object bytes, a manifest of key/size/checksum, policies/configuration, and required recovery secrets through separate protected handling.
3. Keep a backup copy outside the demo host; a volume beside the original data is not protection from host loss.
4. Restore into an isolated environment. Recreate private policies first, restore objects/metadata, reconcile missing/orphaned keys, and check manifest hashes.
5. Exercise a scoped download, a denied cross-user download, and a new upload. Record restore duration and failures before asserting RTO/RPO.

A file copy is not automatically a full backup of version history, lifecycle settings, policies, or provider metadata. Record precisely what is preserved, especially when the selected tier limits version operations. Do not rely on unverified Free replication features.

For migration, copy through supported object APIs, preserve application keys/checksums, validate a sample plus counts/manifests, switch the storage alias/endpoint, and retain a rollback copy until accepted. Reissue signed URLs after cutover. Never mount another provider's data directory and assume compatible on-disk formats.

## 7. Implementation checks and traceability

All checks below are **planned**, not passed. They extend the existing cases without renumbering the baseline.

| Existing anchor | Added scenario | Expected evidence |
|---|---|---|
| FR-FILE-01 / TC-24 | Valid image/video within agreed limits | READY metadata and private retrievable object; detected MIME/size/checksum recorded |
| TC-24 | Forged MIME, oversized stream, unsafe filename | Rejected, no public object/link, bounded temporary storage |
| NFR-SEC-02 / TC-06 | Citizen requests another citizen's evidence URL | Denied before signing; no key/content disclosure |
| NFR-SEC-02 | Anonymous object read/list and cross-service key use | Denied by actual storage policy |
| FR-FILE-01 | Browser and physical mobile access through external hostname | Signed URL works without hostname rewriting or disabled TLS validation |
| FR-FILE-01 | Tampered/expired URL; role revoked after URL issue | Tampering/expiry rejected; documented expiry window or authenticated proxy semantics |
| NFR-REL-01 | Storage unavailable during SOS/evidence upload | SOS remains received; attachment failure visible and retryable |
| NFR-REL-01 | Crash after upload before READY commit | Reconciliation resolves orphan/pending state without duplicate attachment |
| TC-29 / NFR-OPS-01 | Database plus object restore on another host | Manifest checks, scoped download, denied cross-user access, measured restore time |
| Optional direct upload | Reuse URL after finalization, swapped key, duplicate finalize | Final evidence immutable; foreign key rejected; finalize idempotent |
| Deployment readiness | License validity, artifact digest, credentials, policy, disk usage | Recorded release/terms/check results; no secrets in report |

## 8. Decisions to record before the storage slice

- Edition/provider and release digest; do not write only “MinIO” in the installation guide.
- Team acceptance of current license terms and an authorized artifact acquisition path.
- File types, maximum sizes/counts, retention, deletion authority, and evidence immutability policy.
- Backend-mediated versus direct upload; externally reachable hostname and TLS routing.
- Exact bucket policies/service credentials, download expiry, and immediate-revocation requirements.
- Backup destination, checkpoint procedure, restore evidence, and operational ownership.

The AI integration should consume approved structured request data first. It does not need bucket credentials merely because AIStor has “AI” in its name. Future image analysis would require a separately authorized evidence-reading path, data-minimization rules, and its own evaluation.
