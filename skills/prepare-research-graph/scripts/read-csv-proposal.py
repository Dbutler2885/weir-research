"""Read the experimental CSV deliverable using Python's standard CSV parser."""
import csv
import json
import math
import sys
from pathlib import Path


TABLES = {
    "proposal": "schemaVersion,baseGraphRevision,researchRevision,consumedUpdateSequence,title,summary",
    "nodes": "id,kind,label,existingId",
    "node-evidence": "nodeId,evidenceRef",
    "claims": "id,subjectId,predicate,objectType,objectValue,qualification,time,reasoning",
    "claim-evidence": "claimId,evidenceRef,role",
    "groups": "id,title,nodeIds,claimIds,dependsOn",
    "identities": "nodeIds,decision,reason,evidenceRefs",
    "coverage": "findingRef,nodeIds,claimIds,omissionReason",
    "issues": "id,kind,question,nodeIds,claimIds,evidenceRefs,provisionalTreatment,requestedResearch,blocksGroupIds",
    "representation-notes": "id,nodeIds,claimIds,issueIds,decision,alternatives,reason",
}


def read_proposal(directory):
    directory = Path(directory)
    tables = {}
    for name, header in TABLES.items():
        path = directory / (name + ".csv")
        if path.is_symlink():
            raise ValueError(f"{path.name}: expected a regular file, not a symlink")
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream, strict=True)
            if reader.fieldnames != header.split(","):
                raise ValueError(f"{path.name}: expected header {header}")
            rows = list(reader)
        for row in rows:
            if None in row or any(v is None for v in row.values()):
                raise ValueError(f"{path.name}: row has the wrong number of columns")
        tables[name] = rows

    def array(value):
        return value.split("|") if value else []

    def convert(rows, fields):
        return [{k: array(v) if k in fields else v for k, v in row.items()} for row in rows]

    if len(tables["proposal"]) != 1:
        raise ValueError("proposal.csv must have exactly one metadata row")
    proposal = tables["proposal"][0]
    for key in ["schemaVersion", "baseGraphRevision", "consumedUpdateSequence"]:
        proposal[key] = int(proposal[key])

    nodes = tables["nodes"]
    claims = tables["claims"]
    node_ids = {row["id"] for row in nodes}
    claim_ids = {row["id"] for row in claims}
    for name, key, allowed in [("node-evidence", "nodeId", node_ids), ("claim-evidence", "claimId", claim_ids)]:
        seen = set()
        for row in tables[name]:
            if row[key] not in allowed:
                raise ValueError(f"{name}.csv: unknown {key} {row[key]}")
            signature = tuple(row.values())
            if signature in seen:
                raise ValueError(f"{name}.csv: duplicate evidence link {signature}")
            seen.add(signature)
    for node in nodes:
        node["existingId"] = node["existingId"] or None
        node["evidenceRefs"] = [r["evidenceRef"] for r in tables["node-evidence"] if r["nodeId"] == node["id"]]
    for claim in claims:
        kind, value = claim.pop("objectType"), claim.pop("objectValue")
        if kind == "number":
            value = float(value)
            if not math.isfinite(value):
                raise ValueError(f"Nonfinite number in claim {claim['id']}")
        elif kind not in ["entity", "text"]:
            raise ValueError(f"Unknown objectType {kind}")
        claim["object"] = {"entityId" if kind == "entity" else "value": value}
        claim["time"] = claim["time"] or None
        claim["evidence"] = [{"ref": r["evidenceRef"], "role": r["role"]} for r in tables["claim-evidence"] if r["claimId"] == claim["id"]]
    proposal["nodes"], proposal["claims"] = nodes, claims
    proposal["groups"] = convert(tables["groups"], ["nodeIds", "claimIds", "dependsOn"])
    proposal["identityDecisions"] = convert(tables["identities"], ["nodeIds", "evidenceRefs"])
    proposal["coverage"] = convert(tables["coverage"], ["nodeIds", "claimIds"])
    proposal["issues"] = convert(tables["issues"], ["nodeIds", "claimIds", "evidenceRefs", "blocksGroupIds"])
    for issue in proposal["issues"]:
        issue["requestedResearch"] = issue["requestedResearch"] or None
    proposal["representationNotes"] = convert(tables["representation-notes"], ["nodeIds", "claimIds", "issueIds"])
    for note in proposal["representationNotes"]:
        note["alternatives"] = note["alternatives"].splitlines()
    return proposal


if __name__ == "__main__":
    try:
        print(json.dumps(read_proposal(sys.argv[1]), ensure_ascii=False, allow_nan=False))
    except (ValueError, OSError, csv.Error) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
