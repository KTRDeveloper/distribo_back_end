# ADR-006: Payment aggregator for Mobile Money subscriptions

Status: proposed

## Context
Design v16 (section 5.4) has a business pay its plan on a website with MTN MoMo or Orange Money. The server creates the payment request at an aggregator, receives its confirmation, checks that the confirmation comes from it, then asks it for the payment status again. The design names no aggregator, and CONVENTIONS.md allows no HTTP client package for a third-party service, no package for it, and only one URL (`http://localhost:3000`).

## Decision
Proposed, not applied: a human picks the aggregator, gives the exact versions of any package it needs, adds its host to the allowed URLs and supplies the credentials as environment variables, once this ADR is accepted.

Until then, no story calls an aggregator. Every billing story goes through the port `PaymentAggregator` (request a payment, read a status, verify a confirmation, list a day's statement) with a fake adapter used in tests and local runs. `PAYMENT_DRIVER` accepts only `fake`. The real adapter is not in any story.

Rejected for now: confirming a payment from what the browser shows (it proves nothing, design 5.4); writing a payment by hand as the normal path (it stays an administrator gesture, BIL-024).

## Consequences
- The backlog is implementable with the fake adapter: the whole payment flow works in tests, not in production, until this ADR is accepted and a technical story adds the real adapter.
- Accepting the ADR means a change to CONVENTIONS.md (the allowlist and the allowed URLs, from `_meta/src/project.yaml`), the secrets in the environment validation, and a dependency audit.
- Open question Q-041 tracks the decision.
