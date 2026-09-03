# SDK reference integrations

**V2:** This package is the COV-026 dogfooding surface. The own-app,
milestone, marketplace, and agent examples use only `@covenant/sdk` for
Platform operations. They create a Covenant, request authority, transport
externally produced evidence, execute, retrieve the operation, and read the
non-authoritative audit view. A separate valid cancellation helper exercises
the pre-submission cancellation path.

The examples do not import `@covenant/core`, `@covenant/runtime`, authority,
executor, Circle, or Arc RPC code. Tests stand up the in-process API and use
deterministic signed fixtures only to model the external authority boundary.
No API key or signer credential is placed in browser/client code.
