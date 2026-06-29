"""Entry point: `python -m cue_runner`."""
from __future__ import annotations

import asyncio
import logging

from dotenv import load_dotenv

from .config import Config
from .runner import run_forever


def main() -> None:
    load_dotenv()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    cfg = Config.from_env()
    try:
        asyncio.run(run_forever(cfg))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
