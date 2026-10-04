# Security

Open at INIT step 5 (risk per module), when writing the project YAML (baseline) and when writing abuse cases.

Contents: 1 Sources · 2 ASVS usage · 3 Risk per module · 4 Baseline · 5 Abuse-case patterns · 6 Dependencies · 7 Conditional references

## 1. Sources, and what each is used for

| source | use |
|---|---|
| OWASP ASVS 5.0.0 (`asvs-5.0.0.csv`, CC BY-SA 4.0) | the requirements: cite IDs in stories, pick the level per module |
| OWASP Top 10:2025 | prioritize: A01 Broken Access Control, A02 Security Misconfiguration, A03 Software Supply Chain Failures, A04 Cryptographic Failures, A05 Injection, A06 Insecure Design, A07 Authentication Failures, A08 Software or Data Integrity Failures, A09 Security Logging and Alerting Failures, A10 Mishandling of Exceptional Conditions |
| CWE Top 25 (2025) | prioritize; the web-relevant entries most stories map to: CWE-79, 89, 352, 862, 22, 94, 434, 502, 863, 20, 284, 200, 306, 918, 77, 639, 770 |
| OWASP Cheat Sheet Series | concrete rules: Password Storage, Authentication, Session Management, Authorization, Input Validation, Mass Assignment, File Upload, Logging, Error Handling, Secrets Management, Third Party Payment Gateway Integration, Denial of Service, Abuse Case |
| OWASP WSTG v4.2 | security tests: cite the test ID in the Tests `covers` column (WSTG-ATHZ-04, ...) |
| NIST SSDF (SP 800-218 v1.1) | process: PW.1 risk-based design (this step), PW.4 reuse well-secured components (allowlist), PW.5 secure coding (CONVENTIONS), PW.7 code review (risk: high), PW.8 testing (Tests), PO.3 toolchain (FND-000 SAST, secret scan, audit), RV.1 vulnerability intake (dependency audit in CI) |

Never load the CSV or a whole cheat sheet into context: query, then cite.

## 2. ASVS usage

```
python3 $SKILL/scripts/asvs_lookup.py --level L2 --chapter V8            # authorization, L1+L2
python3 $SKILL/scripts/asvs_lookup.py --section 6.2 --width 120          # password requirements
python3 $SKILL/scripts/asvs_lookup.py --keyword "upload|file size" --level L2
python3 $SKILL/scripts/asvs_lookup.py --check v5.0.0-8.2.2 v5.0.0-5.2.2  # IDs exist?
python3 $SKILL/scripts/asvs_lookup.py --chapters
```

- Cite the versioned form `v5.0.0-<chapter>.<section>.<req>`; render_stories.py and validate.py reject anything else.
- Level choice per module, with a one-line justification in MODULE.md:
  - L1: public or low-value data, no personal data, no money;
  - L2 (default): personal data, business data, money flows, accounts; most applications;
  - L3: high-value transactions, health or other special-category data, safety, or a module other modules trust for security decisions, when the design asks for high assurance.
- A story cites only the requirements its code must satisfy beyond the baseline. Security bullets are story-specific.

| topic | chapter | usual IDs |
|---|---|---|
| injection, output encoding | V1 | 1.2.1, 1.2.3, 1.2.4, 1.3.6 (SSRF) |
| input validation, business logic, anti-automation | V2 | 2.2.1, 2.2.2, 2.2.3, 2.3.1, 2.3.3, 2.3.4, 2.4.1 |
| browser security, cookies, CORS, headers | V3 | 3.3.1, 3.3.4, 3.4.1, 3.4.2, 3.5.3 |
| API and HTTP | V4 | 4.1.1, 4.1.3 |
| file upload, storage, download | V5 | 5.2.1, 5.2.2, 5.3.1, 5.3.2, 5.4.1 |
| authentication, passwords, MFA, OTP | V6 | 6.2.x, 6.3.1, 6.3.8, 6.4.3, 6.5.1–6.5.5, 6.6.2, 6.6.3 |
| sessions | V7 | 7.2.1–7.2.4, 7.3.1, 7.3.2, 7.4.1–7.4.3, 7.5.1 |
| authorization, multi-tenancy | V8 | 8.2.1, 8.2.2, 8.2.3, 8.3.1, 8.4.1 |
| self-contained tokens (JWT) | V9 | 9.1.1, 9.1.2, 9.1.3, 9.2.1, 9.2.2, 9.2.3 |
| OAuth, OIDC | V10 | query the chapter |
| cryptography, hashing, randomness | V11 | 11.3.2, 11.4.1, 11.4.2, 11.5.1 |
| TLS | V12 | 12.2.1, 12.3.1 |
| configuration, secrets, outbound allowlist | V13 | 13.2.1, 13.2.4, 13.3.1, 13.4.2 |
| data protection, sensitive data in URLs, caching | V14 | 14.2.1, 14.2.4, 14.3.2 |
| dependencies, mass assignment, minimal responses | V15 | 15.1.1, 15.2.1, 15.3.1, 15.3.3, 15.3.5 |
| logging and error handling | V16 | 16.2.1, 16.2.5, 16.3.1–16.3.3, 16.4.1, 16.5.1, 16.5.3 |

Third-party payment webhooks have no dedicated ASVS requirement: cite 13.2.1 (authenticated backend communication), 11.4.1 (approved HMAC), 2.3.3 and 2.3.4 (transactions, no double processing), 2.2.1 (server-side amounts) and 16.3.3 (log bypass attempts).

## 3. Risk per module (INIT step 5)

1. Data classification of each owned field that is not plainly public: `public`, `internal`, `confidential` (business data), `PII`, `credential` (password hashes, tokens, OTP, keys), `payment`. Handling per class: never logged (credential, payment, PII), returned only to authorized roles, masked in lists, excluded from test fixtures (use fake data), encrypted or hashed at rest when the design asks or when it is a credential.
2. Lightweight STRIDE: one line per relevant letter, for the module's entry points: Spoofing (who can pretend to be whom), Tampering (which values a client could alter: IDs, amounts, statuses), Repudiation (which actions need an audit trail), Information disclosure (what a response, error or log could leak), Denial of service (what is expensive or unbounded), Elevation of privilege (which role or tenant boundary could be crossed). Each line gets a mitigation and becomes abuse cases in the stories that expose it (`MODULE.md` threats table: `ID | STRIDE | threat | mitigation | abuse cases`).
3. ASVS level and its justification.
4. `risk:` of each story: high when it implements or changes authentication, the access-control layer, cryptography, payment, file upload or a data migration; medium when it exposes a protected resource through existing controls; low otherwise. A risk: high story is reviewed by a human or a stronger model before done, unless the project replaces the `review` line (§4).

## 4. Baseline

CONVENTIONS.md already carries the security baseline, each line tagged in `assets/CONVENTIONS.md`: `queries`, `authorization`, `passwords`, `tokens`, `rate-limit`, `input-size`, `security-logging`. In the project YAML:
- `baseline_omit`: tags that do not apply (for example `passwords` when the design has no password);
- `baseline`: stack- or design-specific lines, each with its ASVS ID (for example the token lifetimes the design states, the password hashing library from the allowlist, CORS origins, cookie flags when the design uses cookies);
- `replace`: `tag: line` for a generic line the project states differently, for example `status-codes` when a failed validation answers 400, not 422. Every generic line of `assets/CONVENTIONS.md` has a tag, except the agent rules and the Definition of Done, which no project changes; only the Definition of Done's `review` line can be replaced, for example to waive the review when a strong enough agent implements the stories. Never append a line that contradicts a generic one: the agent would read both.
Never contradict the design: when it states a mechanism (bcrypt, sessions, OTP), the baseline follows it, and a weaker choice becomes an open question, not a silent change.

## 5. Abuse-case patterns

Pick the patterns the story exposes. Horizontal and vertical access are mandatory for any protected resource or action. Titles end with the pattern in parentheses, so reviewers see coverage at a glance.

```gherkin
Scenario: AB-1 Another owner's product (horizontal)
  Given product X owned by seller A
  When seller B reads, updates or deletes X
  Then the response is 404 and X is unchanged
Scenario: AB-2 Seller calls an admin action (vertical)
  When a SELLER calls POST /api/v1/admin/products/{id}/remove
  Then the response is 403 and nothing changes
```

| pattern | STRIDE | test (covers) | CWE | ASVS |
|---|---|---|---|---|
| horizontal access: another user's or tenant's object, by ID in path, query or body | I, T, E | WSTG-ATHZ-04 | CWE-639, CWE-862 | 8.2.2, 8.4.1 |
| vertical access: lower role calls a higher role's action | E | WSTG-ATHZ-03 | CWE-862, CWE-863 | 8.2.1 |
| no, expired, tampered or wrong-type token | S | WSTG-ATHN-04, WSTG-SESS-07 | CWE-306, CWE-613 | 8.2.1, 9.1.1, 9.2.1, 9.2.2 |
| mass assignment: client sends server-owned fields (owner, role, status, price set by server) | T, E | — | CWE-915 | 15.3.3 |
| list or search leaks other tenants' rows, or hidden fields | I | WSTG-ATHZ-02 | CWE-200, CWE-639 | 8.4.1, 15.3.1 |
| account enumeration through messages, codes or timing | I | WSTG-IDNT-04 | CWE-204 | 6.3.8 (L3), 2.4.1 |
| brute force on login, codes or reset | S, D | WSTG-ATHN-03 | CWE-307 | 6.3.1, 6.6.3, 2.4.1 |
| refresh-token replay after rotation, token used after logout | S | WSTG-SESS-06 | CWE-294, CWE-613 | 7.4.1, 7.2.4 |
| injection through a query built from input (search, sort, filter) | T, I | WSTG-INPV-05 | CWE-89 | 1.2.4 |
| oversized or deeply nested input, unbounded page size | D | WSTG-BUSL-07 | CWE-770, CWE-400 | 2.2.1, 15.2.2 |
| upload: wrong type, spoofed extension, oversized, path in the file name | T, E, D | WSTG-BUSL-08, WSTG-BUSL-09, WSTG-ATHZ-01 | CWE-434, CWE-22 | 5.2.1, 5.2.2, 5.3.1, 5.3.2 |
| payment: amount or currency from the client, forged or replayed webhook, double capture | T, R | WSTG-BUSL-02, WSTG-BUSL-04 | CWE-345, CWE-294, CWE-362 | 2.2.1, 2.3.3, 2.3.4, 13.2.1, 11.4.1 |
| workflow: skipped step or illegal state transition | T | WSTG-BUSL-06 | CWE-841 | 2.3.1 |
| race on a limited resource or balance | T | WSTG-BUSL-04 | CWE-362 | 2.3.4 |
| privileged action without audit trail | R | — | CWE-778 | 16.3.1, 16.3.2 |
| server fetches a URL from input | I, E | WSTG-INPV-19 | CWE-918 | 1.3.6, 13.2.4 |
| error or response leaks internals | I | WSTG-ERRH-01 | CWE-209, CWE-200 | 16.5.1, 15.3.1 |

## 6. Dependencies

- The allowlist in CONVENTIONS.md lists every package with an exact version: runtime, dev, and CI actions or images. Seed it from the design's stack, else from `assets/defaults.yaml`. Any other package is forbidden. Why: models hallucinate package names, and attackers register them (slopsquatting).
- A story names the allowlisted packages it uses. A new package needs a design decision: record it as an open question, never add it in a story.
- FND-000 wires the dependency audit into CI (A03 Software Supply Chain Failures; ASVS 15.2.1).

## 7. Conditional references

Open one only when its condition holds, and apply it to the stories concerned:
- `api-security.md`: the system exposes an HTTP API (OWASP API Security Top 10 2023);
- `masvs.md`: a mobile app is in scope (OWASP MASVS v2);
- `llm-top10.md`: the system calls a language model (OWASP Top 10 for LLM Applications 2025);
- `wcag.md`: the design includes a user interface (WCAG 2.2 AA);
- `gdpr.md`: personal data is processed (GDPR, or the law the design names).
