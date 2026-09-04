# Project Progress — superseded

This file described a 7-test prototype and has been overtaken by roughly two orders of magnitude
of work. It is kept only so that links to it land somewhere honest.

**Current status lives in [`COMPLETION_PLAN.md`](COMPLETION_PLAN.md)** — verified gate results, the
remaining-work register, and the sequence to v1.
**Standing decisions live in [`DECISIONS.md`](DECISIONS.md)** — what was chosen, why, and what
would reverse it.

For the history: [`AUDIT_REPORT.md`](AUDIT_REPORT.md) is what was wrong, and
[`REMEDIATION.md`](REMEDIATION.md) is what was fixed.

For deployment: [`DEPLOYMENT.md`](DEPLOYMENT.md), and run `scripts/preflight.sh` first.

The claims this file used to make — "7/7 tests passed", "5/5 frontend tests", "production bundle
validation with zero errors" — were true of a prototype whose executed PDFs stamped every field
upside down, whose audit chain verified as valid after being edited in the database, and which had
no billing at all. That is worth remembering about status documents in general: a green checkmark
is a claim, not evidence. Every number in `COMPLETION_PLAN.md` carries the command that produced it.
