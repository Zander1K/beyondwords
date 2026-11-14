from app.db.models import Base

EXPECTED_TABLES = {
    "users",
    "books",
    "user_books",
    "pages",
    "lines",
    "word_bank",
    "reading_events",
}


def test_all_section_5_tables_are_mapped() -> None:
    assert set(Base.metadata.tables) == EXPECTED_TABLES


def test_books_has_no_text_column() -> None:
    # CLAUDE.md: books hold metadata only, never book text.
    columns = set(Base.metadata.tables["books"].columns.keys())
    assert columns == {
        "id",
        "title",
        "author",
        "isbn",
        "edition",
        "language",
        "level",
        "created_at",
    }


def test_initial_migration_matches_models() -> None:
    """The hand-written migration 0001 must create exactly what the models declare."""
    import importlib.util
    from pathlib import Path

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import MetaData, create_engine, inspect

    path = Path(__file__).parents[4] / "db/migrations/versions/0001_initial_tables.py"
    spec = importlib.util.spec_from_file_location("migration_0001", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)

    # SQLite in-memory is only a structural check (tables/columns/indexes), not MariaDB DDL.
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            spec.loader.exec_module(module)
            module.upgrade()
        insp = inspect(conn)
        migrated = MetaData()
        migrated.reflect(conn)
        for name, table in Base.metadata.tables.items():
            assert name in migrated.tables, name
            assert set(migrated.tables[name].columns.keys()) == set(table.columns.keys()), name
            model_indexes = {i.name for i in table.indexes}
            db_indexes = {i["name"] for i in insp.get_indexes(name)}
            assert model_indexes <= db_indexes, (name, model_indexes - db_indexes)
