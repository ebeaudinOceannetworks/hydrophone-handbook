"""Open Oceans 3.0 annotation status for hydrophone deployments.

Reads the public annotation search used by Oceans 3.0. No database connection.
An open note has no end date. A hydrophone's own note counts for the deployment
it started in. A note on a parent (junction box, node, icLink) that is still
open counts for the hydrophone deployed now, even when the note started earlier.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

ANNOTATION_SERVICE = "https://data.oceannetworks.ca/AnnotationServiceV3"
ANNOTATION_SEARCH = "https://data.oceannetworks.ca/AnnotationsV2"

_RED = {
    "data gap": "Data gap",
    "compromised": "Compromised",
    "failed": "Failed",
}
_YELLOW = {
    "commissioning": "Commissioning",
    "data quality": "Data quality",
    "needs review": "Needs review",
}
_IGNORE = {"calibration information", "science event"}
_TICKET = re.compile(r"\b[A-Z]{2,}-\d+\b")
_RANK = {"green": 0, "yellow": 1, "red": 2, "ended": -1}


def annotate_deployments(rows, devices_by_code):
    """Return a new list of deployment rows with status and open notes.

    Raises if a device id cannot be resolved or the annotation service fails.
    A failed lookup must not be published as "no issues."
    """
    missing = sorted({row["deviceCode"] for row in rows if row["deviceCode"] not in devices_by_code})
    if missing:
        raise RuntimeError("No device id for hydrophone(s): " + ", ".join(missing))

    device_ids = sorted({int(devices_by_code[row["deviceCode"]]["deviceId"]) for row in rows})
    notes_by_device = _fetch_open_notes(device_ids)

    annotated = []
    for row in rows:
        device = devices_by_code[row["deviceCode"]]
        device_id = int(device["deviceId"])
        begin = _as_utc(row.get("begin"))
        end = _as_utc(row.get("end"))
        current = end is None
        matched = []
        for note in notes_by_device.get(device_id, []):
            if _note_applies(note, begin, end, current):
                matched.append({key: value for key, value in note.items() if key != "start_dt"})
        matched.sort(key=lambda note: (_RANK[note["level"]], note["start"] or ""), reverse=True)
        status = _worst(note["level"] for note in matched) if current or matched else "ended"
        annotated.append({
            **row,
            "deviceId": device_id,
            "begin": _date_text(begin),
            "end": _date_text(end),
            "status": status,
            "notes": matched,
            "annotationUrl": _annotation_url(device_id, device.get("deviceName") or row["deviceCode"]),
        })
    return annotated


def _note_applies(note, begin, end, current):
    """Own notes stay with the deployment they started in.

    Parent notes that are still open also apply to the hydrophone in the
    water now, including when the note predates that deployment.
    """
    if not note["own"] and current:
        return True
    return _in_window(note.get("start_dt"), begin, end)


def _in_window(started, begin, end):
    if started is None:
        return True
    if begin is not None and started.date() < begin.date():
        return False
    if end is not None and started.date() > end.date():
        return False
    return True


def _worst(levels):
    chosen = "green"
    for level in levels:
        if _RANK.get(level, 0) > _RANK[chosen]:
            chosen = level
    return chosen


def _fetch_open_notes(device_ids):
    found = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(_open_notes_for_device, device_id): device_id for device_id in device_ids}
        for future in as_completed(futures):
            device_id = futures[future]
            found[device_id] = future.result()
    return found


def _open_notes_for_device(device_id):
    notes = []
    seen = set()
    for page in range(1, 9):
        payload = _get_annotations(device_id, page)
        rows = payload.get("naiveAnnotationList") or []
        if not rows:
            break
        hit_closed = False
        for row in rows:
            if row.get("endDate"):
                hit_closed = True
                continue
            note = _normalize_note(row, device_id)
            if note is None or note["id"] in seen:
                continue
            seen.add(note["id"])
            notes.append(note)
        if hit_closed or page >= (payload.get("totalNumOfPages") or 1):
            break
    return notes


def _get_annotations(device_id, page):
    params = {
        "annotationSources": "3,5",
        "resourceTypeId": "2",
        "resourceId": str(device_id),
        "includeTopology": "true",
        "published": "Y",
        "pageSize": "40",
        "pageNum": str(page),
        "levelIndexes": "0,1,2,3,4,5",
        "orderBy": "endDate",
        "order": "desc",
    }
    url = ANNOTATION_SERVICE + "?" + urllib.parse.urlencode(params)
    last_error = None
    for attempt in range(2):
        request = urllib.request.Request(url, headers={"User-Agent": "hydrophone-handbook", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                data = json.load(response)
            break
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            time.sleep(1.5)
    else:
        raise RuntimeError(f"Annotation lookup failed for device {device_id}: {last_error}") from last_error
    if "payload" not in data:
        message = data.get("message") or "no payload"
        raise RuntimeError(f"Annotation lookup failed for device {device_id}: {message}")
    return data["payload"]


def _normalize_note(row, device_id):
    fields = _fields(row)
    summary = row.get("annotationSummary") or ""
    level, label = _classify(fields.get("category") or "", summary)
    if level is None:
        return None
    try:
        own = int(row.get("resourceId")) == int(device_id)
    except (TypeError, ValueError):
        own = False
    started = _as_utc(row.get("startDate"))
    return {
        "id": row.get("annotationId"),
        "level": level,
        "label": label,
        "text": _note_text(summary, fields.get("details") or ""),
        "start": _date_text(started),
        "start_dt": started,
        "own": own,
    }


def _fields(row):
    names = {"4": "comment", "5": "category", "6": "details", "123": "preview", "126": "priority"}
    ids = row.get("formFieldIds") or []
    values = row.get("formFieldValues") or []
    return {names.get(str(item_id), str(item_id)): value for item_id, value in zip(ids, values)}


def _classify(category, summary):
    text = " ".join((summary or "").split())
    lower = text.lower()
    if "sensitivity corrupted" in lower:
        return "red", "Compromised"
    cat = (category or "").strip().lower()
    leading = _leading_label(lower)
    if cat in _RED:
        return "red", _RED[cat]
    if leading in _RED:
        return "red", _RED[leading]
    if cat in _YELLOW:
        return "yellow", _YELLOW[cat]
    if leading in _YELLOW:
        return "yellow", _YELLOW[leading]
    if cat in _IGNORE or leading in _IGNORE:
        return None, None
    if text:
        return "yellow", "Open note"
    return None, None


def _leading_label(lower):
    parts = [part.strip() for part in lower.split("|") if part.strip()]
    return parts[0] if parts else ""


def _note_text(summary, details):
    details = " ".join((details or "").split())
    summary = " ".join((summary or "").split())
    if details and details.lower() not in {".", "undefined"}:
        return _strip_tickets(details)
    parts = [part.strip() for part in summary.split("|")]
    parts = [part for part in parts if part and part.lower() not in {"low", "medium", "high", "."}]
    labels = set(_RED) | set(_YELLOW) | _IGNORE
    if len(parts) >= 2 and parts[0].lower() in labels:
        return _strip_tickets(parts[1])
    return _strip_tickets(summary)


def _strip_tickets(text):
    """Drop Jira keys such as DATA-1234. Device names like MiniJB-06 stay."""
    cleaned = _TICKET.sub("", text or "")
    cleaned = re.sub(r"\(\s*\)", "", cleaned)
    parts = [part.strip(" ,;:-") for part in cleaned.split("|")]
    parts = [part for part in parts if part and part not in {".", "-"}]
    cleaned = " | ".join(parts)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" |,;:-")
    return cleaned


def _annotation_url(device_id, device_name):
    name = device_name or f"Device {device_id}"
    if f"({device_id})" not in name:
        name = f"{name} ({device_id})"
    params = [
        ("sourceFilter", "3"),
        ("sourceFilter", "5"),
        ("resourceFilter.resourceTypeId", "2"),
        ("resourceFilter.resource.id", str(device_id)),
        ("resourceFilter.resource.name", name),
        ("resourceFilter.includeTopology", "true"),
    ]
    return ANNOTATION_SEARCH + "?" + urllib.parse.urlencode(params)


def _as_utc(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    text = str(value).strip()
    if not text or text.lower() in {"nat", "none", "nan"}:
        return None
    text = text.replace("Z", "+00:00")
    if " " in text and "T" not in text:
        text = text.replace(" ", "T", 1)
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _date_text(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).strftime("%Y-%m-%d")
    return str(value)[:10]
