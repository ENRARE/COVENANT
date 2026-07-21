# Procurement agent scaffold

**MVP:** This package will contain the untrusted procurement agent. COV-001 includes no agent behavior.

**MVP:** The agent may eventually propose `PaymentIntent` objects. It must never receive Circle credentials, a funded wallet, or an authorization signing key, and it cannot authorize or execute payments.
