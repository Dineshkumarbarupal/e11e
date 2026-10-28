# CI validation

The repository's GitHub Actions workflow runs on pushes to main and pull requests targeting main.

## Current automated checks
1. Install root frontend dependencies using Node 24 LTS.
2. Install API/worker package dependencies.
3. Run JavaScript syntax checks for frontend and server files.
4. Run browser workflow-engine unit tests.
5. Run server schema, worker-executor and credential-encryption tests.
6. Build the Vite static site.

The workflow being configured does not itself imply the latest code has passed. The associated GitHub Actions run is the source of truth. Before a public launch, add database-backed API integration tests and end-to-end tests for account lifecycle, tenant isolation, webhooks, queue retries, and execution persistence.
