"""Application logging.

Uvicorn only attaches handlers to its own `uvicorn.*` loggers, so without this a
module-level `logging.getLogger(__name__)` writes to a root logger that has
nowhere to send anything. Calling `configure_logging()` once at startup gives
application loggers a destination without disturbing uvicorn's.
"""
import logging
import os
from logging.config import dictConfig

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()


def configure_logging() -> None:
    dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "standard": {
                    "format": "%(asctime)s %(levelname)-8s %(name)s: %(message)s",
                    "datefmt": "%Y-%m-%d %H:%M:%S",
                }
            },
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "formatter": "standard",
                    "stream": "ext://sys.stdout",
                }
            },
            "root": {"handlers": ["console"], "level": LOG_LEVEL},
            "loggers": {
                # Leave uvicorn's own loggers alone; they are already configured.
                "uvicorn": {"propagate": False},
                "uvicorn.error": {"propagate": False},
                "uvicorn.access": {"propagate": False},
            },
        }
    )
    logging.getLogger(__name__).debug("Logging configured at %s", LOG_LEVEL)
