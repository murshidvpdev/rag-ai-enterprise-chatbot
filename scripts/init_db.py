"""Create the PostgreSQL tables from infra/schema.sql.

Safe to run repeatedly: every statement uses CREATE ... IF NOT EXISTS and nothing is dropped.
Usage (from the repository root):  uv run python -m scripts.init_db
"""
from pathlib import Path

from app.db import connection

SCHEMA = Path(__file__).resolve().parent.parent / 'infra' / 'schema.sql'


def main():
    with connection() as conn:
        conn.execute(SCHEMA.read_text())
        tables = [r['tablename'] for r in conn.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").fetchall()]
    print('Schema applied. Tables:', ', '.join(tables))


if __name__ == '__main__':
    main()
