## Scope

- Issue: COV-
- Scope label: MVP / V2 / Production / Protocol

## Summary

Describe the exact change and why it is in scope.

## Security impact

Describe trust-boundary, signer, money, typed-data, credential, replay, and onchain-state effects. Write “none” only with a reason.

## Verification

- [ ] Formatting validation passes.
- [ ] Lint passes.
- [ ] Strict TypeScript checking passes.
- [ ] Relevant TypeScript tests pass.
- [ ] Build passes.
- [ ] Relevant Foundry tests pass.
- [ ] `pnpm verify` passes.
- [ ] Complete diff reviewed.
- [ ] No secret or real credential is included.
- [ ] Documentation capabilities have explicit scope labels.

## Frozen-architecture check

- [ ] The agent has no Circle credential, funded wallet, or authorization signing key.
- [ ] The executor cannot modify signed payment fields.
- [ ] Authoritative spend/replay state remains onchain.
- [ ] No arbitrary execution, upgradeability, new chain, new policy system, signer change, typed-data change, or unapproved MVP expansion is introduced.
