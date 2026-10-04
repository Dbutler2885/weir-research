"""The project's research library, read into variables.

documents() lists the saved documents, sources() the project's sources, corrections(id)
what was decided where a document's text and a quote disagreed, read(id)
gives a document's text as pages, text(id) as one string, and search(pattern) finds
lines across the documents' text.
"""

import csv
import os
import re

FOLDER = os.environ.get("WEIR_LIBRARY", "")
PAGE = re.compile(r"^\[Page (\d+)\]\n", re.M)


def _path(*parts):
    if not FOLDER:
        raise RuntimeError("This session has no research library.")
    return os.path.join(FOLDER, *parts)


def _rows(*parts):
    with open(_path(*parts), encoding="utf-8", newline="") as file:
        return list(csv.DictReader(file))


def documents():
    """Every saved document: id, name, collection, file, text and pages."""
    return _rows("documents", "documents.csv")


def sources():
    """Every source the project knows, by ID."""
    return _rows("sources.csv")


def _document(doc_id):
    for row in documents():
        if row["id"] == doc_id:
            return row
    raise KeyError(f"No saved document has the ID {doc_id!r}.")


def corrections(doc_id=None):
    """What was decided where a document's text and a published quote disagreed, for
    one document or, with no ID, for every document as {id: [...]}.

    Each is {"pages", "status", "decision", "wording", "reason", "revision"}, with
    "text": {"page", "before", "after"} where the document's text was corrected and
    "quote": {"before", "after"} where a quote was. decision is "old" when the
    earlier wording was what the page says, "new" when the new reading was,
    "transcribed" when the passage was read from the page itself, and "unsettled"
    when the page did not settle it and the quote keeps its wording.
    """
    import json

    path = _path("documents", "corrections.json")
    if not os.path.exists(path):
        return [] if doc_id is not None else {}
    with open(path, encoding="utf-8") as file:
        every = json.load(file)
    return every.get(doc_id, []) if doc_id is not None else every


def read(doc_id):
    """A document's text as a list of pages, each {"page": n, "text": ..., "revision": r}.

    A PDF's text has "[Page n]" before each page; any other text document is one page.
    The revision is the document's text revision, which rises when it is read again.
    Each revision's text is a file of its own that never changes, so the text returned
    is always the revision named with it.
    """
    row = _document(doc_id)
    if row["text"] == "not read yet":
        raise ValueError(f"Document {doc_id} is a PDF that has not been read yet.")
    with open(_path(row["text"]), encoding="utf-8", errors="replace") as file:
        content = file.read()
    revision = int(row.get("revision") or 1)
    marks = list(PAGE.finditer(content))
    if not marks:
        return [{"page": 1, "text": content, "revision": revision}]
    pages = []
    for n, mark in enumerate(marks):
        end = marks[n + 1].start() if n + 1 < len(marks) else len(content)
        pages.append({"page": int(mark.group(1)), "text": content[mark.end():end].rstrip("\n"), "revision": revision})
    return pages


def text(doc_id):
    """A document's whole text, without page marks."""
    return "\n\n".join(p["text"] for p in read(doc_id))


def search(pattern, ids=None, flags=re.IGNORECASE):
    """Lines matching a regular expression across the documents' text, or those named
    by ids, each {"document", "page", "line", "text"}."""
    wanted = re.compile(pattern, flags)
    found = []
    for row in documents():
        if ids is not None and row["id"] not in ids:
            continue
        if row["text"] == "not read yet" or not row["text"].endswith((".txt", ".md", ".csv", ".json", ".html")):
            continue
        for page in read(row["id"]):
            for number, line in enumerate(page["text"].split("\n"), 1):
                if wanted.search(line):
                    found.append({"document": row["id"], "page": page["page"], "line": number, "text": line})
    return found
