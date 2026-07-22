{\rtf1\ansi\ansicpg1252\cocoartf2870
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\froman\fcharset0 Times-Roman;}
{\colortbl;\red255\green255\blue255;\red255\green255\blue255;}
{\*\expandedcolortbl;;\cssrgb\c100000\c100000\c100000;}
\margl1440\margr1440\vieww28600\viewh14760\viewkind0
\deftab720
\pard\pardeftab720\partightenfactor0

\f0\fs24 \cf2 \expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 cat > ~/lecture-pipeline/scripts/run_lecture_pipeline.py <<'PY'\
import os\
import csv\
import json\
import time\
import subprocess\
from pathlib import Path\
from urllib.request import urlretrieve\
\
BASE = Path.home() / "lecture-pipeline"\
DATA = BASE / "data"\
AUDIO = BASE / "audio"\
TRANSCRIPTS = BASE / "transcripts_ar"\
FINAL = BASE / "final"\
LOGS = BASE / "logs"\
\
CSV_PATH = DATA / "lectures.csv"\
PROGRESS_PATH = LOGS / "progress.json"\
\
AUDIO.mkdir(parents=True, exist_ok=True)\
TRANSCRIPTS.mkdir(parents=True, exist_ok=True)\
FINAL.mkdir(parents=True, exist_ok=True)\
LOGS.mkdir(parents=True, exist_ok=True)\
\
def load_progress():\
    if PROGRESS_PATH.exists():\
        return json.loads(PROGRESS_PATH.read_text(encoding="utf-8"))\
    return \{"done": []\}\
\
def save_progress(progress):\
    PROGRESS_PATH.write_text(json.dumps(progress, ensure_ascii=False, indent=2), encoding="utf-8")\
\
def run(cmd):\
    print("RUN:", " ".join(cmd))\
    subprocess.run(cmd, check=True)\
\
def ollama_translate(ar_text):\
    prompt = f"""Translate the following Arabic lecture transcript into clear English.\
Rules:\
- Translate only into English.\
- Do not summarize.\
- Do not omit anything.\
- Preserve Islamic/theological terms carefully.\
- Return only the English translation.\
\
Arabic:\
\{ar_text\}\
"""\
    result = subprocess.run(\
        ["ollama", "run", "qwen2.5:3b", prompt],\
        capture_output=True,\
        text=True,\
        check=True\
    )\
    return result.stdout.strip()\
\
def find_audio_url_field(row):\
    # prefer the direct MP3 column you identified\
    for key in row.keys():\
        if key.strip().lower() == "bg-info href":\
            return row[key].strip()\
    return None\
\
def safe_name(text):\
    return "".join(c if c.isalnum() or c in "-_ " else "_" for c in text).strip().replace(" ", "_")[:120]\
\
def process_one(row):\
    title = row.get("Title", "") or row.get("title", "") or row.get("\uc0\u1575 \u1604 \u1593 \u1606 \u1608 \u1575 \u1606 ", "") or "lecture"\
    lecture_id = row.get("No.", "") or row.get("number", "") or safe_name(title)\
    audio_url = find_audio_url_field(row)\
\
    if not audio_url:\
        raise ValueError(f"No audio URL found for row: \{title\}")\
\
    stem = safe_name(f"\{lecture_id\}_\{title\}")\
    audio_path = AUDIO / f"\{stem\}.mp3"\
    out_dir = TRANSCRIPTS / stem\
    out_dir.mkdir(parents=True, exist_ok=True)\
\
    print(f"\\n=== Processing: \{title\} ===")\
    print("Downloading:", audio_url)\
    urlretrieve(audio_url, audio_path)\
\
    # Transcribe Arabic with diarization\
    run([\
        "whisperx",\
        str(audio_path),\
        "--model", "large-v3",\
        "--language", "ar",\
        "--diarize",\
        "--hf_token", os.environ["HF_TOKEN"],\
        "--output_dir", str(out_dir)\
    ])\
\
    # Find WhisperX JSON output\
    json_files = list(out_dir.glob("*.json"))\
    if not json_files:\
        raise RuntimeError(f"No WhisperX JSON output found in \{out_dir\}")\
    transcript_json = json_files[0]\
\
    data = json.loads(transcript_json.read_text(encoding="utf-8"))\
\
    segments_out = []\
    for seg in data.get("segments", []):\
        ar = (seg.get("text") or "").strip()\
        if not ar:\
            continue\
        en = ollama_translate(ar)\
        segments_out.append(\{\
            "speaker": seg.get("speaker"),\
            "start": seg.get("start"),\
            "end": seg.get("end"),\
            "ar": ar,\
            "en": en\
        \})\
\
    final_obj = \{\
        "lecture_id": str(lecture_id),\
        "title": title,\
        "audio_url": audio_url,\
        "segments": segments_out\
    \}\
\
    final_path = FINAL / f"\{stem\}.json"\
    final_path.write_text(json.dumps(final_obj, ensure_ascii=False, indent=2), encoding="utf-8")\
    print("Saved:", final_path)\
\
    # delete raw audio to save space\
    try:\
        audio_path.unlink()\
    except Exception:\
        pass\
\
    return stem\
\
def main():\
    progress = load_progress()\
    done = set(progress["done"])\
\
    with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:\
        reader = csv.DictReader(f)\
        rows = list(reader)\
\
    # first pass: only process ONE lecture for testing\
    for row in rows:\
        title = row.get("Title", "") or row.get("title", "") or row.get("\uc0\u1575 \u1604 \u1593 \u1606 \u1608 \u1575 \u1606 ", "") or "lecture"\
        lecture_id = row.get("No.", "") or row.get("number", "") or safe_name(title)\
        key = f"\{lecture_id\}|\{title\}"\
        if key in done:\
            continue\
\
        stem = process_one(row)\
        done.add(key)\
        progress["done"] = sorted(done)\
        save_progress(progress)\
        print("\\nTEST RUN COMPLETE.")\
        print(f"Finished lecture: \{stem\}")\
        break\
\
if __name__ == "__main__":\
    main()\
PY}