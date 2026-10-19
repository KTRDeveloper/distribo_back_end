# ADR-005: Dependencies for image re-encoding and S3-compatible storage

Status: proposed

## Context
Design v16 (section 12) stores photos in an S3-compatible service and re-encodes every uploaded photo on the server, so the stored file carries no metadata and no trace of the uploader. CONVENTIONS.md allows only the packages it lists, and none of them handles images or S3. The module `images` (ADR-004) needs both in production.

## Decision
Proposed, not applied: add two runtime packages once a human accepts this ADR and gives exact versions checked on the registry:
- an image library for decoding, resizing and re-encoding (candidate: `sharp`);
- an S3 client (candidate: `@aws-sdk/client-s3`).

Until then, no story imports either package. Every story that stores or re-encodes an image goes through a port (`ImageStorage`, `ImageProcessor`) with a fake adapter used in tests and local runs. The real adapters are not in any story.

Rejected for now: writing the images to the local disk (does not match section 12 and does not scale across instances); hand-written S3 requests with `pg`-style raw HTTP (re-implements request signing).

## Consequences
- The backlog is implementable with the fake adapters; photos work in tests, not in production, until this ADR is accepted and a technical story adds the real adapters.
- Accepting the ADR means a change to CONVENTIONS.md (the allowlist, from `_meta/src/project.yaml`) and a dependency audit.
- Open question Q-040 tracks the decision.
