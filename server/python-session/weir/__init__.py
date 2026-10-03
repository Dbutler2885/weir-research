"""The research workspace's package for a researcher's Python session.

library: the project's research library, read into variables.
output(id): the whole output of a run whose printed output was cut short.
"""

import os

from . import library


def output(run_id):
    """The whole output of a run whose printed output was cut short."""
    path = os.path.join(os.environ.get("HOME", ""), "outputs", f"{os.path.basename(run_id)}.txt")
    if not os.path.exists(path):
        raise KeyError(f"No whole output is kept for {run_id!r}; only the most recent long ones are.")
    with open(path, encoding="utf-8") as file:
        return file.read()


__all__ = ["library", "output"]
