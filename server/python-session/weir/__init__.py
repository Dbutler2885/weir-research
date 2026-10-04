"""The research workspace's package for a researcher's Python session.

library: the project's research library, read into variables.
save(url): saves a web page or PDF into the library, for the whole team.
jev(document, questions): sweeps a long document for the passages likely to matter.
reader(question, passages): asks cheap readers about passages, and returns their answers.
post(text): posts to the batch's board, for the whole team.
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


def jev(document, questions, threshold=0.3):
    """Sweeps a saved document with yes-or-no questions, and returns the passages
    likely to matter, ready for weir.reader.

    Jev is a fast, cheap model that gives each small chunk of the document a
    probability of yes for each question; it finds where to look, and readers then
    read. questions is a list of yes-or-no questions, or a dict of name to question,
    up to 20; ask them plainly and narrowly, such as "Does this text mention the sale
    of a mill?". A chunk is flagged when any question's probability reaches the
    threshold. Flagged chunks are widened by a chunk each side and joined into
    passages of up to about 100,000 characters; when most of the document is
    flagged, the whole of it comes back as passages.

    Returns {"document", "passages", "chunks", "flagged", "characters", "passed",
    "whole"}. Each passage is {"label", "document", "pages": [{"page", "text"}],
    "from": {"page", "line"}, "to": {"page", "line"}, "probability", "matched",
    "characters"}, where matched names the questions that flagged it, and can be
    passed to weir.reader as it is. Answers are kept, so sweeping the same document
    with the same question again costs nothing. Raises weir.AppError, saying why,
    when the document has no text or the app has no TypeSafe key.
    """
    return _app.call("jev", document=document, questions=questions, threshold=threshold)


def reader(question, passages=None):
    """Asks a reader: a cheap model that sees only what you send it, and answers once.

    reader(prompt) sends one prompt of up to about 100,000 characters and returns the
    reply as text.

    reader(question, passages) asks the question of each passage and returns a list of
    answers in the passages' order. A passage is {"label": ..., "text": ...}, or
    {"label": ..., "pages": [{"page": n, "text": ...}]} as weir.library.read gives
    pages; a dict of label to text, or a list of strings, works too. Each passage is
    up to about 100,000 characters. Each answer is
    {"label", "relevant", "answer", "quotes": [{"page", "quote", "found"}], "cached"}:
    relevant is False when the passage does not answer the question. found says
    whether the quoted words are in the passage, and page is the page the app found
    them on, whatever the reader cited. Anything else you put
    in a passage, such as "document", comes back in its answer. A passage whose
    reader failed has "problem" in place of the answer.

    Send as many passages as you like in one call: the app packs them whole into as
    few prompts as hold them and runs the readers side by side. Answers are kept, so
    asking the same question of the same passage again returns at once and costs
    nothing. Raises weir.AppError, saying why, when no reader could run.
    """
    if passages is None:
        return _app.call("reader", prompt=question)
    if isinstance(passages, dict):
        passages = [{"label": label, "text": text} for label, text in passages.items()]
    else:
        passages = [{"label": str(n), "text": p} if isinstance(p, str) else p for n, p in enumerate(passages, 1)]
    return _app.call("reader", question=question, passages=passages)


def post(text):
    """Posts to your batch's board, and returns {"posted": True, "id": ...}.

    Every teammate receives the post at once, as a message, and it wakes any who had
    finished; it stays on the board in the library for those who start later. Post
    what the team can use: what you mean to try, a source found or ruled out, an
    identity settled, a lead you are leaving for someone else. Raises weir.AppError
    when the same text was already posted from your seat.
    """
    return _app.call("post", text=text)


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


__all__ = ["AppError", "jev", "library", "output", "post", "publish", "reader", "save"]
