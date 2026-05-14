import sqlite3


def test_sqlite_fts5_search():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE VIRTUAL TABLE articles_fts USING fts5(title, summary, content, tags_text, tokenize='unicode61')")
    conn.execute(
        "INSERT INTO articles_fts(title, summary, content, tags_text) VALUES (?, ?, ?, ?)",
        ("한국은행 기준금리 동결", "금통위 뉴스", "물가 안정", "기준금리, 물가"),
    )
    rows = conn.execute("SELECT rowid, title FROM articles_fts WHERE articles_fts MATCH ?", ("한국은행",)).fetchall()
    assert rows == [(1, "한국은행 기준금리 동결")]
