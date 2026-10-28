# Security policy

This repository is an early MVP. Do not use it to automate production business systems, store production credentials, or expose the API to the public internet without additional engineering review.

## Sensitive areas
Workflow automation software can hold powerful tokens and send outbound requests. Treat every workflow, webhook payload, imported JSON file and integration response as untrusted.

## Current safeguards
- Browser UI has no secret vault; do not store API keys in localStorage or workflow config.
- API validates key environment variables at startup, uses a JWT secret, limits request size, applies request rate limiting and restricts CORS to explicit origins.
- SQL statements use parameters; workspace member checks scope workflow/execution/credential lookups.
- Registration passwords are hashed using bcrypt.
- Credential payloads are encrypted with AES-256-GCM before database persistence; the API returns only credential metadata.
- The server executor deliberately refuses HTTP nodes until outbound network policy and credential references exist.
- Server runs use a bounded step budget and the server schema rejects graph cycles.

## Known gaps / no production guarantee
- No MFA, SSO, email verification, password reset, refresh/revocation flow, invitation/member-management UI or full role administration.
- Browser-side HTTP is limited by browser CORS and is not an enterprise integration runtime.
- The server HTTP node is disabled. Do not enable it by bypassing the guard; implement DNS/IP pinning, private/link-local/metadata blocking, redirect revalidation, egress policy and abuse testing first.
- Credentials are encrypted at rest with an environment key. Key rotation, KMS integration, backup-key management, rotation workflows and deletion auditing need implementation.
- Audit coverage is not transactional for every operation and has not had an independent review.
- No formal threat model, penetration test, load test, disaster-recovery drill or compliance assessment has been completed.
- Workflow execution history can contain sensitive input/output data; retention and redaction policies are not implemented.
- Browser JWT/local-storage integration is not implemented. If adding it, consider XSS/session-theft implications and use an appropriate session model.

## Reporting
Do not open a public issue containing credentials, tokens, private customer data or exploit payloads. Rotate any secret that has been committed or copied into logs.
