FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg nodejs ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir 'yt-dlp[default]'

WORKDIR /app
COPY snazzy_recover.py /app/snazzy_recover.py
CMD ["python", "/app/snazzy_recover.py"]
