"""Pluggable blob storage: local disk (dev/tests) or S3-compatible (R2, prod).

Backend is chosen by ``STORAGE_BACKEND`` (``local`` | ``s3``). Keys are neutral
strings like ``books/B-02/source.pdf``. The OCR pipeline must run ``pdftoppm``
on a real local file, so :meth:`Storage.materialize` returns a local path —
the actual file for local storage, or a downloaded temp file for S3.

S3/R2 env: ``S3_BUCKET`` (required), ``S3_ENDPOINT_URL`` (R2 account endpoint),
``S3_REGION``, ``S3_ACCESS_KEY_ID``, ``S3_SECRET_ACCESS_KEY``.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

from . import config


class Storage:
    def save_bytes(self, key: str, data: bytes, content_type: str | None = None) -> None:
        raise NotImplementedError

    def read_bytes(self, key: str) -> bytes:
        raise NotImplementedError

    def delete(self, key: str) -> None:
        raise NotImplementedError

    def exists(self, key: str) -> bool:
        raise NotImplementedError

    def materialize(self, key: str) -> str:
        """Return a LOCAL filesystem path for ``key`` (for pdftoppm etc.)."""
        raise NotImplementedError

    def signed_url(self, key: str, expires: int = 3600) -> str | None:
        return None


class LocalStorage(Storage):
    """Files under a local root (``config.upload_dir()`` by default)."""

    def __init__(self, root: str):
        self.root = Path(root)

    def _p(self, key: str) -> Path:
        return self.root / key

    def save_bytes(self, key: str, data: bytes, content_type: str | None = None) -> None:
        p = self._p(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def read_bytes(self, key: str) -> bytes:
        return self._p(key).read_bytes()

    def delete(self, key: str) -> None:
        try:
            self._p(key).unlink()
        except FileNotFoundError:
            pass

    def exists(self, key: str) -> bool:
        return self._p(key).exists()

    def materialize(self, key: str) -> str:
        return str(self._p(key))


class S3Storage(Storage):
    """S3-compatible object storage (AWS S3 or Cloudflare R2 via endpoint_url)."""

    def __init__(self, bucket: str, endpoint_url: str | None, region: str | None,
                 access_key: str | None, secret_key: str | None):
        import boto3  # lazy: only needed when STORAGE_BACKEND=s3

        self.bucket = bucket
        self.client = boto3.client(
            "s3", endpoint_url=endpoint_url, region_name=region,
            aws_access_key_id=access_key, aws_secret_access_key=secret_key,
        )

    def save_bytes(self, key: str, data: bytes, content_type: str | None = None) -> None:
        extra = {"ContentType": content_type} if content_type else {}
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, **extra)

    def read_bytes(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:  # noqa: BLE001 — head raises 404 as ClientError
            return False

    def materialize(self, key: str) -> str:
        data = self.read_bytes(key)
        suffix = os.path.splitext(key)[1] or ".bin"
        fd, path = tempfile.mkstemp(prefix="haydari-blob-", suffix=suffix)
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        return path

    def signed_url(self, key: str, expires: int = 3600) -> str | None:
        return self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=expires
        )


_STORAGE: Storage | None = None


def get_storage() -> Storage:
    global _STORAGE
    if _STORAGE is None:
        _STORAGE = _build()
    return _STORAGE


def _build() -> Storage:
    backend = os.environ.get("STORAGE_BACKEND", "local").strip().lower()
    if backend == "s3":
        return S3Storage(
            bucket=os.environ["S3_BUCKET"],
            endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None,
            region=os.environ.get("S3_REGION") or None,
            access_key=os.environ.get("S3_ACCESS_KEY_ID") or None,
            secret_key=os.environ.get("S3_SECRET_ACCESS_KEY") or None,
        )
    return LocalStorage(config.upload_dir())


def reset_for_test() -> None:  # pragma: no cover - test helper
    global _STORAGE
    _STORAGE = None
