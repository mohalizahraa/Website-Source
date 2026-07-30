"""Pluggable blob storage: local disk (dev/tests) or S3-compatible (R2, prod).

Backend is chosen by ``STORAGE_BACKEND`` (``local`` | ``s3``). Keys are neutral
strings like ``books/B-02/source.pdf``. The OCR pipeline must run ``pdftoppm``
on a real local file, so :meth:`Storage.materialize` returns a local path —
the actual file for local storage, or a downloaded temp file for S3.

S3/R2 env: ``S3_BUCKET`` (required), ``S3_ENDPOINT_URL`` (R2 account endpoint),
``S3_REGION``, ``S3_ACCESS_KEY_ID``, ``S3_SECRET_ACCESS_KEY``.
"""
from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path

from . import config


def safe_key(key: str) -> str:
    """Validate a storage key and return it, or raise ValueError.

    Keys are relative, forward-slash paths (``books/B-01/source.pdf``). Reject
    absolute paths, ``..`` traversal, empty/whitespace parts, backslashes, and
    control characters so a crafted key can never escape the local storage root
    (or land somewhere unexpected in a bucket). Applied centrally by every
    backend, so even a user-supplied ``source_pdf`` (import) is constrained.
    """
    if not key or not isinstance(key, str):
        raise ValueError("empty storage key")
    if key.startswith("/") or "\\" in key or any(ord(c) < 32 for c in key):
        raise ValueError(f"unsafe storage key: {key!r}")
    parts = key.split("/")
    if any(p in ("", ".", "..") for p in parts):
        raise ValueError(f"unsafe storage key: {key!r}")
    return key


class Storage:
    # True when materialize() returns a throwaway TEMP copy that the caller must
    # clean up (S3); False when it returns the real persistent file (local).
    materialize_is_temp: bool = False

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

    def cleanup_local(self, path: str) -> None:
        """Release a path returned by :meth:`materialize`. No-op unless the
        backend created a temporary copy (S3) that must be removed."""

    def signed_url(self, key: str, expires: int = 3600) -> str | None:
        return None

    def presigned_upload_url(
        self, key: str, content_type: str, expires: int = 3600
    ) -> str | None:
        """Return a direct-upload URL, or ``None`` when unsupported."""
        return None

    def object_info(self, key: str) -> dict | None:
        """Return object metadata used to verify a direct upload."""
        return None


class LocalStorage(Storage):
    """Files under a local root (``config.upload_dir()`` by default)."""

    def __init__(self, root: str):
        self.root = Path(root)

    def _p(self, key: str) -> Path:
        return self.root / safe_key(key)

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

    def object_info(self, key: str) -> dict | None:
        path = self._p(key)
        if not path.exists():
            return None
        digest = hashlib.md5(usedforsecurity=False)  # noqa: S324
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                digest.update(chunk)
        return {
            "ContentLength": path.stat().st_size,
            "ContentType": "application/pdf",
            "ETag": f'"{digest.hexdigest()}"',
        }


class S3Storage(Storage):
    """S3-compatible object storage (AWS S3 or Cloudflare R2 via endpoint_url)."""

    materialize_is_temp = True  # materialize() downloads to a temp file

    def __init__(self, bucket: str, endpoint_url: str | None, region: str | None,
                 access_key: str | None, secret_key: str | None):
        import boto3  # lazy: only needed when STORAGE_BACKEND=s3

        self.bucket = bucket
        self.client = boto3.client(
            "s3", endpoint_url=endpoint_url, region_name=region,
            aws_access_key_id=access_key, aws_secret_access_key=secret_key,
        )

    def save_bytes(self, key: str, data: bytes, content_type: str | None = None) -> None:
        key = safe_key(key)
        extra = {"ContentType": content_type} if content_type else {}
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, **extra)

    def read_bytes(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=safe_key(key))["Body"].read()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=safe_key(key))

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self.client.head_object(Bucket=self.bucket, Key=safe_key(key))
            return True
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if code in ("404", "NoSuchKey", "NotFound") or status == 404:
                return False
            raise  # a real error (auth, network, throttle) must NOT look like 404

    def materialize(self, key: str) -> str:
        data = self.read_bytes(key)
        suffix = os.path.splitext(key)[1] or ".bin"
        fd, path = tempfile.mkstemp(prefix="haydari-blob-", suffix=suffix)
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        return path

    def cleanup_local(self, path: str) -> None:
        # Ownership is decided by the caller (only called for a temp we made),
        # but stay guarded to the temp dir so we can never remove a real file.
        if path and os.path.realpath(path).startswith(os.path.realpath(tempfile.gettempdir())):
            try:
                os.unlink(path)
            except OSError:
                pass

    def signed_url(self, key: str, expires: int = 3600) -> str | None:
        return self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=expires
        )

    def presigned_upload_url(
        self, key: str, content_type: str, expires: int = 3600
    ) -> str | None:
        return self.client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self.bucket,
                "Key": safe_key(key),
                "ContentType": content_type,
            },
            ExpiresIn=expires,
        )

    def object_info(self, key: str) -> dict | None:
        return self.client.head_object(Bucket=self.bucket, Key=safe_key(key))


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
