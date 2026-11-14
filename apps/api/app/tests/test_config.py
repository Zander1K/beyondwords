from app.config import to_asyncpg_url


def test_aiven_runtime_url_is_converted_for_asyncpg() -> None:
    url = "postgresql://avnadmin:p%40ss@db.aivencloud.com:13547/defaultdb?sslmode=require&uselibpqcompat=true"
    assert to_asyncpg_url(url) == (
        "postgresql+asyncpg://avnadmin:p%40ss@db.aivencloud.com:13547/defaultdb?ssl=require"
    )


def test_postgres_scheme_and_existing_asyncpg_urls() -> None:
    assert to_asyncpg_url("postgres://u:p@h:5432/d") == "postgresql+asyncpg://u:p@h:5432/d"
    url = "postgresql+asyncpg://u:p@h:5432/d?ssl=require"
    assert to_asyncpg_url(url) == url


def test_non_postgres_urls_pass_through() -> None:
    assert to_asyncpg_url("sqlite://") == "sqlite://"
