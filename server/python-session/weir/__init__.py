"""The research workspace's package for a researcher's Python session.

library: the project's research library, read into variables.
save(url): saves a web page or PDF into the library, for the whole team.
publish(...): publishes a finding with its evidence, for the human and the team.
output(id): the whole output of a run whose printed output was cut short.
"""

import os

from . import _app, library
from ._app import AppError


def output(run_id):
    """The whole output of a run whose printed output was cut short."""
    path = os.path.join(os.environ.get("HOME", ""), "outputs", f"{os.path.basename(run_id)}.txt")
    if not os.path.exists(path):
        raise KeyError(f"No whole output is kept for {run_id!r}; only the most recent long ones are.")
    with open(path, encoding="utf-8") as file:
        return file.read()


def save(url, fresh=False):
    """Saves a web page, PDF or text file from the web into the library, and returns
    its receipt: {"id", "title", "url", "pages", "characters", "existing"}.

    The app downloads it, so it is in the library for the whole team at once; read it
    with weir.library.read(receipt["id"]). An address already saved gives the capture
    already there, with "existing" true. fresh=True downloads it again, and gives a new
    document only if the content has changed. Raises weir.AppError, saying why, when
    the download fails or the page has no readable text.
    """
    return _app.call("save", url=url, fresh=bool(fresh))


def publish(statement, qualification, explanation, evidence, replaces=None):
    """Publishes one finding with its evidence, and returns its receipt:
    {"id", "statement", "evidence": [{"document", "pages", "check"}]}.

    qualification is "supported", "reported", "disputed" or "unresolved", where
    unresolved means the sources conflict or are ambiguous.
    evidence is a list of quotes from saved documents, each
    {"document": id, "page": n, "quote": ..., "interpretation": ...}, with
    "pages": [first, last] in place of "page" for a quote over several pages, and
    optionally "stance" ("supports", "challenges" or "context") and "context".
    The app checks that each quote appears in the document's saved text at the pages
    cited; spacing and line breaks do not matter, every other character does.
    replaces is the ID of an earlier finding in this batch, yours or a teammate's,
    that this one corrects.

    Raises weir.AppError, saying why, when the finding is refused: a quote that is
    not on its page comes back with the page it is on, or the nearest passage there.
    """
    finding = {"statement": statement, "qualification": qualification, "explanation": explanation, "evidence": evidence}
    if replaces is not None:
        finding["replaces"] = replaces
    return _app.call("publish", finding=finding)


__all__ = ["AppError", "library", "output", "publish", "save"]
