---
date: 2026-07-29
title: "Make erasure a storage operation, object first"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-07-29: Make erasure a storage operation, object first

- **Date:** 2026-07-29
- **Decision:** Deleting a document erases the object and then the row, in that order, with no
  deferral. If the object cannot be erased the row stays and the caller sees the failure. The
  `documents` row cascades with its owner, but that cascade is explicitly not the erasure path.
- **Why:** The reverse order loses the only pointer to the object. What remains is personal data in
  a bucket that nothing can name: unerasable in practice, invisible to any later audit, and
  undetectable by every test that looks at the database. Immediate erasure is also the only version
  that is straightforward to defend under a right-to-erasure request -- the data is gone when the
  request returns, rather than gone once a job runs.
- **Rejected alternatives:**
  - Soft delete plus a purge job: allows undo and absorbs a provider outage, but creates a window
    where personal data still exists after an erasure request, which then has to be documented,
    bounded and honoured by a job whose failure is silent.
  - Deleting the row and letting the object expire through a lifecycle rule: the same window,
    without even a record of what is owed.
  - Treating the user cascade as erasure: it removes every row and leaves every object. The
    integration suite pins exactly this, so the gap is visible rather than assumed.
- **Acceptance evidence:** Service tests cover the order, and cover that a failing storage removal
  keeps the row so the operation can be retried rather than half-applied. The integration suite
  covers erasure against the real ledger and pins that a user cascade leaves objects behind.
- **When to revisit:** A retention class that requires a legal hold cannot use immediate erasure,
  and is the point at which `docs/FACTORY.md`'s retention classes stop being aspirational. A
  reconciliation job that lists bucket objects with no matching row would close the residue a
  cascade leaves; it needs a listing permission the runtime credentials deliberately do not hold.
