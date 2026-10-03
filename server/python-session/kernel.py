"""A researcher's Python session: runs the code it is sent, one run at a time, in one
namespace that lasts between runs.

The app starts it with the session's folder as its argument. Requests come in on
standard input as JSON lines, {"id", "code"}, and each answer goes out on file
descriptor 3 as one JSON line, so nothing the code prints can be mistaken for one.
Only what the code prints is answered; when that is long, the answer is cut short and
the whole of it is kept in outputs/, where weir.output(id) reads it. After every
completed run the variables are saved with dill, and a new session loads them back.

One process owns the state at a time: the one named in owner.json. A process that is no
longer its owner, or whose app has gone, exits without saving. A run in progress is recorded in running.json, so a run cut short by the
process ending is known afterwards and never replayed.
"""

import io
import json
import os
import sys
import threading
import time
import traceback

import dill

dill.settings["recurse"] = True

FOLDER = sys.argv[1]
VARIABLES = os.path.join(FOLDER, "variables.pkl")
RUNNING = os.path.join(FOLDER, "running.json")
OWNER = os.path.join(FOLDER, "owner.json")
OUTPUTS = os.path.join(FOLDER, "outputs")
KEPT_OUTPUTS = 20
ME = os.environ.get("WEIR_OWNER", "")
LIMIT = int(os.environ.get("WEIR_OUTPUT_LIMIT", "20000"))

requests = sys.stdin.buffer
answers = os.fdopen(3, "w", encoding="utf-8")


def fresh():
    import weir

    return {"__name__": "__main__", "__builtins__": __builtins__, "weir": weir}


namespace = fresh()
# Names already reported as not saved, so each is named once rather than every run.
reported = set()


def owns():
    try:
        with open(OWNER, encoding="utf-8") as file:
            return json.load(file).get("owner") == ME
    except Exception:
        return False


def watch(parent):
    """Exits as soon as the app that started this process has gone."""
    while True:
        if os.getppid() != parent:
            os._exit(0)
        time.sleep(0.2)


def kept():
    return {k: v for k, v in namespace.items() if not k.startswith("__")}


def save():
    """Saves every variable that can be saved, and names those that cannot."""
    values = kept()
    try:
        blob = dill.dumps(values)
        skipped = []
    except Exception:
        saveable, skipped = {}, []
        for name, value in values.items():
            try:
                dill.dumps(value)
                saveable[name] = value
            except Exception as error:
                skipped.append((name, type(value).__name__, error))
        blob = dill.dumps(saveable)
    if not owns():
        os._exit(0)
    partial = VARIABLES + ".tmp"
    with open(partial, "wb") as file:
        file.write(blob)
    os.replace(partial, VARIABLES)
    return skipped


def load():
    """Loads the variables saved after the last completed run."""
    if not os.path.exists(VARIABLES):
        return None
    try:
        with open(VARIABLES, "rb") as file:
            values = dill.load(file)
    except Exception as error:
        return f"The saved variables could not be loaded ({type(error).__name__}: {error}); this session starts empty."
    namespace.update(values)
    return None


def shown(error):
    """A traceback of the run's own code, without the session's frames."""
    frames = [f for f in traceback.extract_tb(error.__traceback__) if f.filename != __file__]
    lines = traceback.format_list(frames) if frames else []
    return "Traceback (most recent call last):\n" + "".join(lines) + "".join(traceback.format_exception_only(type(error), error))


def run(code):
    output = io.StringIO()
    stdout, stderr, stdin = sys.stdout, sys.stderr, sys.stdin
    sys.stdout = sys.stderr = output
    sys.stdin = io.StringIO("")
    failed = False
    try:
        exec(compile(code, "<run>", "exec"), namespace)
    except SyntaxError as error:
        failed = True
        output.write("".join(traceback.format_exception_only(type(error), error)))
    except BaseException as error:
        failed = True
        output.write(shown(error))
    finally:
        sys.stdout, sys.stderr, sys.stdin = stdout, stderr, stdin
    return output.getvalue(), failed


def answer(message):
    answers.write(json.dumps(message) + "\n")
    answers.flush()


def keep(run_id, output):
    """Keeps a long output whole, and only the most recent few."""
    os.makedirs(OUTPUTS, exist_ok=True)
    with open(os.path.join(OUTPUTS, f"{run_id}.txt"), "w", encoding="utf-8") as file:
        file.write(output)
    names = sorted(os.listdir(OUTPUTS), key=lambda name: os.path.getmtime(os.path.join(OUTPUTS, name)))
    for name in names[:-KEPT_OUTPUTS]:
        os.remove(os.path.join(OUTPUTS, name))


def main():
    threading.Thread(target=watch, args=(os.getppid(),), daemon=True).start()
    with open(OWNER, "w", encoding="utf-8") as file:
        json.dump({"pid": os.getpid(), "owner": ME}, file)
    interrupted = None
    if os.path.exists(RUNNING):
        try:
            with open(RUNNING, encoding="utf-8") as file:
                interrupted = json.load(file).get("id")
        except Exception:
            interrupted = "unknown"
        os.remove(RUNNING)
    problem = load()
    answer({"ready": True, "interrupted": interrupted, "problem": problem, "variables": sorted(kept())})
    for line in requests:
        if not line.strip():
            continue
        request = json.loads(line)
        with open(RUNNING, "w", encoding="utf-8") as file:
            json.dump({"id": request["id"], "at": time.time()}, file)
        started = time.time()
        output, failed = run(request["code"])
        skipped = save()
        os.remove(RUNNING)
        unsaved = [(name, kind, error) for name, kind, error in skipped if name not in reported]
        reported.clear()
        reported.update(name for name, _, _ in skipped)
        if unsaved:
            names = ", ".join(f"{name} ({kind})" for name, kind, _ in unsaved)
            output += f"\n[Not kept after this session ends, because they cannot be saved: {names}.]\n"
        truncated = len(output) - LIMIT if len(output) > LIMIT else 0
        if truncated:
            keep(request["id"], output)
            output = output[:LIMIT] + f"\n[Output cut short: {truncated} more characters were printed. The whole output is kept: weir.output({request['id']!r}) returns it. Keep large values in variables and print only what you need.]\n"
        if not owns():
            os._exit(0)
        answer({"id": request["id"], "output": output, "failed": failed, "seconds": round(time.time() - started, 3)})


main()
