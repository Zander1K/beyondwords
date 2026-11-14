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
    # SOP section 5: the shared library holds metadata only, never book text.
    columns = set(Base.metadata.tables["books"].columns.keys())
    assert columns == {
        "id",
        "isbn",
        "title",
        "author",
        "publication_year",
        "language",
        "genre",
        "setting_era",
        "description_spoiler_free",
        "metadata_source",
        "created_at",
    }


def test_no_table_stores_raw_media() -> None:
    # SOP section 10: page images and audio are never stored.
    forbidden = ("image", "photo", "audio", "blob")
    for table in Base.metadata.tables.values():
        for column in table.columns:
            if column.name == "image_hash":  # a SHA-256 hash, not the image
                continue
            assert not any(word in column.name for word in forbidden), (table.name, column.name)


MIGRATIONS = ("0001_initial_tables", "0002_users_username")


def test_migrations_match_models() -> None:
    """The hand-written migrations, run in order, must create exactly what the models declare."""
    import importlib.util
    from pathlib import Path

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import MetaData, UniqueConstraint, create_engine, inspect

    versions = Path(__file__).parents[4] / "db/migrations/versions"
    assert {p.stem for p in versions.glob("[0-9]*.py")} == set(MIGRATIONS), "update MIGRATIONS"

    # SQLite in-memory is only a structural check (tables/columns/indexes), not PostgreSQL DDL.
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for name in MIGRATIONS:
                spec = importlib.util.spec_from_file_location(name, versions / f"{name}.py")
                assert spec and spec.loader
                module = importlib.util.module_from_spec(spec)
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
            model_uniques = {
                c.name for c in table.constraints if isinstance(c, UniqueConstraint) and c.name
            }
            db_uniques = {u["name"] for u in insp.get_unique_constraints(name)}
            assert model_uniques <= db_uniques, (name, model_uniques - db_uniques)
