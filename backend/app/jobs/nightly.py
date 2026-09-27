"""Nightly run: invoice every due rent period, then write overdue statuses.

    python -m app.jobs.nightly                      # as of today
    python -m app.jobs.nightly --as-of 2026-09-30
    python -m app.jobs.nightly --dry-run            # report only, write nothing

Both steps are idempotent, so running it twice in a day — or catching up after
a week the machine was off — posts nothing twice. Schedule it with Windows Task
Scheduler (or cron) with DATABASE_URL and the special account codes set exactly
as for the API server. Exits non-zero if any period could not be invoiced.
"""

import argparse
import sys
from datetime import date

from app.database import SessionLocal
from app.services import contracts as contracts_service


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    parser.add_argument("--dry-run", action="store_true", help="roll back instead of committing")
    args = parser.parse_args(argv)

    with SessionLocal() as db:
        run = contracts_service.invoice_due_rent(db, args.as_of)
        entry_nos = [entry.entry_no for entry in run.entries]
        marked, cleared = contracts_service.refresh_overdue(db, args.as_of)
        if args.dry_run:
            db.rollback()
        else:
            db.commit()

    mode = "DRY RUN — nothing written" if args.dry_run else "committed"
    print(f"nightly as of {args.as_of} ({mode})")
    print(f"  rent invoiced: {len(entry_nos)}  already invoiced: {run.skipped}  failed: {len(run.failures)}")
    if entry_nos:
        print(f"  entries: {', '.join(entry_nos)}")
    print(f"  overdue marked: {marked}  cleared: {cleared}")
    for contract_no, seq_no, detail in run.failures:
        print(f"  FAILED {contract_no} period {seq_no}: {detail}", file=sys.stderr)
    return 1 if run.failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
