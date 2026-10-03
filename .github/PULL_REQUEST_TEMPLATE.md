## What and why

<!-- What does this change, and why? Link the issue: "Closes #123". -->

## How it was tested

<!-- Tests added or updated, and manual checks. For UI changes, add before/after screenshots (synthetic data only). -->

## Checklist

- [ ] No real patient data anywhere in this change (code, tests, fixtures, screenshots, logs)
- [ ] The AI still cannot diagnose, prescribe, approve or finalize anything; citations still resolve to case records
- [ ] Services check permission and case access, and write their audit row in the same transaction
- [ ] Tests cover the change (a bug fix includes a test that fails without it)
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration` and `npm run build` pass locally
- [ ] Schema changes include a migration that preserves existing data
- [ ] Every commit is signed off (`git commit -s`, see CONTRIBUTING.md)
