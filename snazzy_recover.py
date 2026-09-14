import glob
import json
import os
import subprocess
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

VIDEOS = ["rg2Jqbj82Vk", "-dbuBNSwoGU"]
ROOT = Path("/app/public")
ROOT.mkdir(parents=True, exist_ok=True)
status = {"started": time.time(), "videos": {}}


def write_status():
    (ROOT / "status.json").write_text(json.dumps(status, indent=2), encoding="utf-8")


def run(cmd, timeout=240):
    p = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    return p.returncode, p.stdout


def recover(vid):
    out = ROOT / vid
    out.mkdir(exist_ok=True)
    log = []
    url = f"https://www.youtube.com/watch?v={vid}"
    media_base = f"/tmp/{vid}"
    attempts = [
        [],
        ["--extractor-args", "youtube:player_client=tv,web_safari"],
        ["--extractor-args", "youtube:player_client=android_vr"],
        ["--extractor-args", "youtube:player_client=web_safari"],
    ]
    media = None
    for extra in attempts:
        cmd = [
            "yt-dlp", "-v", "--no-playlist", "--remote-components", "ejs:github",
            "--js-runtimes", "node", "--impersonate", "chrome",
            *extra,
            "-f", "worstvideo[height<=360]/worstvideo/worst[height<=360]/worst",
            "-o", media_base + ".%(ext)s", url,
        ]
        try:
            rc, text = run(cmd)
        except Exception as e:
            rc, text = 99, repr(e)
        log.append("\n===== " + " ".join(cmd) + f"\nrc={rc}\n" + text)
        candidates = [p for p in glob.glob(media_base + ".*") if not p.endswith((".part", ".ytdl"))]
        if rc == 0 and candidates:
            media = max(candidates, key=os.path.getsize)
            break

    # If normal video formats remain blocked, try YouTube's own storyboard format.
    if not media:
        cmd = [
            "yt-dlp", "-v", "--no-playlist", "--remote-components", "ejs:github",
            "--js-runtimes", "node", "-f", "sb0/sb1/sb2",
            "-o", str(out / "storyboard.%(ext)s"), url,
        ]
        try:
            rc, text = run(cmd)
        except Exception as e:
            rc, text = 99, repr(e)
        log.append("\n===== " + " ".join(cmd) + f"\nrc={rc}\n" + text)

    result = {"media": bool(media), "sheets": [], "storyboard_files": []}
    if media:
        sheet_pattern = str(out / "sheet-%03d.jpg")
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y", "-i", media,
            "-vf", "fps=1/5,scale=320:-2,tile=5x5:padding=2:margin=2",
            "-q:v", "4", sheet_pattern,
        ]
        try:
            rc, text = run(cmd, timeout=300)
        except Exception as e:
            rc, text = 99, repr(e)
        log.append("\n===== " + " ".join(cmd) + f"\nrc={rc}\n" + text)
        result["sheets"] = [Path(p).name for p in sorted(glob.glob(str(out / "sheet-*.jpg")))]
        try:
            os.remove(media)
        except OSError:
            pass
    result["storyboard_files"] = [Path(p).name for p in sorted(glob.glob(str(out / "storyboard.*")))]
    (out / "access.log").write_text("\n".join(log), encoding="utf-8")
    return result


write_status()
for vid in VIDEOS:
    status["videos"][vid] = {"state": "running"}
    write_status()
    try:
        result = recover(vid)
        status["videos"][vid] = {"state": "complete", **result}
    except Exception as e:
        status["videos"][vid] = {"state": "error", "error": repr(e)}
    write_status()
status["finished"] = time.time()
write_status()

# Simple visual index.
parts = ["<html><body><h1>Snazzy visual recovery</h1><pre>", json.dumps(status, indent=2), "</pre>"]
for vid, info in status["videos"].items():
    parts.append(f"<h2>{vid}</h2>")
    for name in info.get("sheets", []):
        parts.append(f'<div><a href="/{vid}/{name}">{name}</a><br><img src="/{vid}/{name}" style="max-width:100%"></div>')
    for name in info.get("storyboard_files", []):
        parts.append(f'<div><a href="/{vid}/{name}">{name}</a></div>')
    parts.append(f'<div><a href="/{vid}/access.log">access.log</a></div>')
parts.append("</body></html>")
(ROOT / "index.html").write_text("\n".join(parts), encoding="utf-8")

os.chdir(ROOT)
port = int(os.environ.get("PORT", "8080"))
ThreadingHTTPServer(("0.0.0.0", port), SimpleHTTPRequestHandler).serve_forever()
