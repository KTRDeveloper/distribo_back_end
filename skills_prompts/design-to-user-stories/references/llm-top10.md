# OWASP Top 10 for LLM Applications (2025)

Open when the system calls a language model. Each item that applies becomes abuse cases and tests on the story that adds the model call; the call itself goes through a port with a fake adapter, so tests never hit a real model.

| item | what the stories must do | ASVS |
|---|---|---|
| LLM01:2025 Prompt Injection | treat user and retrieved content as data: delimit it, never let it change instructions or tool permissions; abuse case: "ignore previous instructions" in user content changes nothing | 1.3.7, 2.2.1 |
| LLM02:2025 Sensitive Information Disclosure | send the model only the data the feature needs; never secrets or other users' data; filter outputs for PII when the design requires | 14.2.3, 14.2.6 |
| LLM03:2025 Supply Chain | models, SDKs and datasets come from the allowlist, pinned | 15.2.1, 15.2.4 |
| LLM04:2025 Data and Model Poisoning | only curated, access-controlled sources feed training or retrieval | 8.2.2 |
| LLM05:2025 Improper Output Handling | model output is untrusted input: validate against a schema, encode before rendering, never execute it or build queries from it | 1.2.1, 1.2.4, 1.3.2 |
| LLM06:2025 Excessive Agency | tools exposed to the model have least privilege and act with the end user's permissions; destructive actions need confirmation | 8.2.1, 8.3.3 |
| LLM07:2025 System Prompt Leakage | no secrets or authorization logic in prompts; assume the prompt is public | 13.3.1 |
| LLM08:2025 Vector and Embedding Weaknesses | retrieval is filtered by the caller's tenant and permissions before ranking | 8.4.1 |
| LLM09:2025 Misinformation | show sources or confidence where the design asks; never present generated content as verified fact | — |
| LLM10:2025 Unbounded Consumption | per-user quotas, maximum input and output tokens, timeouts, and cost limits | 2.4.1, 15.2.2 |
