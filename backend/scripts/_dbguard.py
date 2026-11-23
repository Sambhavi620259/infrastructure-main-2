"""Safety guard for the test scripts: they insert and delete rows, so they refuse any database
that is not clearly a disposable test database."""
import re
import sys
from urllib.parse import urlparse

_SAFE = re.compile(r"(test|check|scratch|tmp|disposable)", re.IGNORECASE)


def require_disposable(url: str, variable: str) -> str:
    """Return ``url`` if its database name looks disposable; otherwise stop the script."""
    name = (urlparse(url).path or "").lstrip("/")
    if not _SAFE.search(name):
        sys.exit(
            f"Refusing to run: {variable} points at database '{name}'. The test scripts change data, so "
            "the database name must contain 'test', 'check', 'scratch', 'tmp' or 'disposable'."
        )
    return url
