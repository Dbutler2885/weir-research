"""How the session's code reaches the app.

The session has no network, so a call is a file: it is written to calls/ in the
session's folder, naming the run it is made for, and the app's answer appears in
answers/. The app makes the call only while that run's researcher still holds its seat.
"""

import json
import os
import time
import uuid

HOME = os.environ.get("HOME", "")
# The run in progress, set by the session before each run.
RUN = None


class AppError(RuntimeError):
    """The app refused a call or could not carry it out; the message says why."""


def call(name, **arguments):
    """Asks the app to do something, waits for it, and returns its result."""
    call_id = uuid.uuid4().hex
    calls = os.path.join(HOME, "calls")
    os.makedirs(calls, exist_ok=True)
    partial = os.path.join(calls, f"{call_id}.tmp")
    with open(partial, "w", encoding="utf-8") as file:
        json.dump({"run": RUN, "name": name, "arguments": arguments}, file)
    os.replace(partial, os.path.join(calls, f"{call_id}.json"))
    answer = os.path.join(HOME, "answers", f"{call_id}.json")
    while not os.path.exists(answer):
        time.sleep(0.05)
    with open(answer, encoding="utf-8") as file:
        message = json.load(file)
    os.remove(answer)
    if "error" in message:
        raise AppError(message["error"])
    return message.get("result")
