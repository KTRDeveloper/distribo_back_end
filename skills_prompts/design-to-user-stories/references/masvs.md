# OWASP MASVS v2 (mobile apps)

Open when a mobile app is in scope. Mobile stories cite the MASVS control in their `security` bullets as plain text after the ASVS ID of the matching server-side rule (for example `v5.0.0-14.3.3: tokens live in the Keystore/Keychain (MASVS-STORAGE-1)`), since validate.py checks ASVS IDs only.

| control | what the stories must do |
|---|---|
| MASVS-STORAGE-1 | store sensitive data only in platform secure storage (Keystore, Keychain) or encrypted databases; never in plain preferences or logs |
| MASVS-STORAGE-2 | prevent leaks: no sensitive data in logs, backups, screenshots, clipboard or notifications |
| MASVS-CRYPTO-1 | use platform crypto APIs with current algorithms; no custom crypto |
| MASVS-CRYPTO-2 | keys generated and kept in hardware-backed storage; none hard-coded |
| MASVS-AUTH-1 | authentication and authorization are decided by the server; the app only holds tokens |
| MASVS-AUTH-2 | local authentication (biometrics, device lock) only unlocks a server session; never replaces it |
| MASVS-AUTH-3 | sensitive operations ask for a fresh authentication when the design says so |
| MASVS-NETWORK-1 | TLS only, platform certificate validation, no cleartext traffic |
| MASVS-NETWORK-2 | certificate or key pinning for the project's own endpoints, when the design asks for it |
| MASVS-PLATFORM-1 | IPC (intents, deep links, content providers) validates its input and exports nothing by default |
| MASVS-PLATFORM-2 | WebViews: JavaScript off unless needed, no file access, only allowlisted origins |
| MASVS-PLATFORM-3 | the UI hides sensitive data in the app switcher and in screenshots where the design requires it |
| MASVS-CODE-1 | a minimum OS version, set in the build |
| MASVS-CODE-2 | a forced-update mechanism, when the design has one |
| MASVS-CODE-3 | dependencies from the allowlist, audited in CI |
| MASVS-CODE-4 | all input (server responses, deep links, files) validated and sanitized |
| MASVS-RESILIENCE-1..4 | platform integrity, anti-tampering, anti-static and anti-dynamic analysis: only when the design asks for them |
| MASVS-PRIVACY-1..4 | minimize data and permissions, avoid identifiers that track users, be transparent about collection, give the user control over their data |

Offline-first apps: the server revalidates every row the device sends (the device is untrusted), and conflict rules come from the design; a missing rule is an open question.
