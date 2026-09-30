# OWASP API Security Top 10 (2023)

Open when the system exposes an HTTP API. For each item that applies to a story, add the abuse case and the test; cite the ASVS ID in `security`, and the API item in the test name when useful.

| item | what the stories must do | ASVS |
|---|---|---|
| API1:2023 Broken Object Level Authorization | every endpoint taking an object ID checks the caller's ownership or tenant in the query itself; abuse case: another user's ID in path, query or body returns 404 | 8.2.2, 8.4.1 |
| API2:2023 Broken Authentication | token verification, expiry, rotation and rate limits live in one middleware from the auth module; abuse cases: no, expired, tampered token | 6.3.1, 9.1.1, 9.2.1 |
| API3:2023 Broken Object Property Level Authorization | responses built from explicit field lists; writable fields listed per operation; abuse case: sending server-owned fields | 8.2.3, 15.3.1, 15.3.3 |
| API4:2023 Unrestricted Resource Consumption | maximum page size, body size, string and array lengths, upload size; rate limits on costly endpoints; abuse case: page size 10,000 is capped or rejected | 2.2.1, 2.4.1, 15.2.2 |
| API5:2023 Broken Function Level Authorization | every route declares its roles; admin routes grouped behind the role check; abuse case: lower role calls the route | 8.2.1 |
| API6:2023 Unrestricted Access to Sensitive Business Flows | flows the design marks sensitive (sign-up, checkout, invitations) get per-account and per-IP limits | 2.4.1, 2.3.2 |
| API7:2023 Server Side Request Forgery | a URL taken from input is fetched only through an allowlist of hosts; abuse case: internal address | 1.3.6, 13.2.4 |
| API8:2023 Security Misconfiguration | CORS allowlist, security headers, no stack traces, debug off: FND-000 and CONVENTIONS | 3.4.2, 13.4.2, 16.5.1 |
| API9:2023 Improper Inventory Management | every route is versioned (`/api/v1`) and documented by the story that adds it; no undocumented route | 13.4.5 |
| API10:2023 Unsafe Consumption of APIs | third-party responses are validated with a schema like user input, with timeouts; they go through the adapter | 2.2.1, 16.5.2 |
