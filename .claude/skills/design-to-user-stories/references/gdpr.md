# Personal data (GDPR, or the law the design names)

Open when the design processes personal data. When the design names another law (for example a national data-protection law), follow the obligations it states; use the GDPR articles below as the checklist, and record any obligation the design leaves unclear as an open question. Never invent a legal basis, a retention period or a consent flow.

| principle or right | what the stories must do |
|---|---|
| Art. 5(1)(c) data minimisation | collect and return only the fields the design lists; no extra fields "for later" |
| Art. 5(1)(e) storage limitation | implement the retention periods the design states (purge or anonymize jobs with tests); none stated: open question |
| Art. 5(1)(f) integrity and confidentiality, Art. 32 security | the security baseline, plus encryption or hashing the design requires; personal data never in logs (ASVS v5.0.0-16.2.5) |
| Art. 6 lawful basis, Art. 7 consent | consent flows only when the design describes them: record what was accepted, when and which version, and allow withdrawal |
| Art. 15 access, Art. 20 portability | export of the person's own data when the design includes it; scoped to that person only (abuse case: another person's export) |
| Art. 16 rectification | the person can correct their data where the design allows it |
| Art. 17 erasure | deletion or anonymization as the design defines it, including backups and derived data it names; blocked cases (open balance, legal hold) as the design states |
| Art. 25 data protection by design and by default | private by default: fields visible to others only where the design says so |
| Art. 30 records of processing | out of scope for stories unless the design asks for a register |
| Art. 33 and 34 breach notification | security events are logged so that a breach can be investigated (ASVS v5.0.0-16.3.x) |
| Art. 35 impact assessment | not a story; mention it in the summary when the design processes special-category data at scale |
| Art. 44 and following, transfers | hosting and third parties outside the jurisdiction only as the design states; otherwise an open question |

Test fixtures use fake personal data only.
