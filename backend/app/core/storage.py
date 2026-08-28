"""Swappable object storage.

``LocalStorage`` remains the default so development and the test suite are
unchanged. ``S3Storage`` is selected with ``STORAGE_BACKEND=s3`` and imports
boto3 lazily, so the dependency is optional.

Routes that currently do ``FileResponse(storage.path(key))`` cannot work on
S3. Use :meth:`url_for` (a presigned URL, or ``None`` for local) and
:meth:`open_stream` instead.
"""

from __future__ import annotations

import logging
import posixpath
import re
from pathlib import Path, PurePosixPath
from typing import BinaryIO
from uuid import uuid4

from fastapi import UploadFile

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_UNSAFE_SEGMENT = re.compile(r"^\.{1,2}$")


class StoragePathError(ValueError):
    """Raised when a storage key escapes the storage root."""


def normalize_key(relative_path: str) -> str:
    """Normalize and validate a storage key.

    Keys ultimately derive from user input (uploaded filenames), so anything
    absolute, drive-qualified, or containing traversal segments is rejected
    rather than normalized away.
    """

    if not isinstance(relative_path, str) or not relative_path.strip():
        raise StoragePathError("Empty storage path")
    candidate = relative_path.replace("\\", "/").strip()
    if candidate.startswith("/") or PurePosixPath(candidate).is_absolute():
        raise StoragePathError("Absolute storage path is not allowed")
    if "\x00" in candidate:
        raise StoragePathError("Invalid storage path")
    segments = [segment for segment in candidate.split("/") if segment not in ("", ".")]
    if not segments:
        raise StoragePathError("Empty storage path")
    for segment in segments:
        if _UNSAFE_SEGMENT.match(segment):
            raise StoragePathError("Path traversal is not allowed in storage paths")
    return posixpath.join(*segments)


class LocalStorage:
    backend = "local"

    def __init__(self, root: str | None = None) -> None:
        settings = get_settings()
        self.root = Path(root or settings.upload_dir).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, relative_path: str) -> Path:
        key = normalize_key(relative_path)
        root = self.root.resolve()
        path = (root / key).resolve()
        if path != root and root not in path.parents:
            raise StoragePathError("Invalid storage path")
        return path

    async def save_upload(self, upload: UploadFile, folder: str, filename: str | None = None) -> str:
        name = filename or f"{uuid4()}-{upload.filename or 'upload.bin'}"
        relative_path = normalize_key(f"{folder.strip('/')}/{Path(name).name}")
        destination = self._resolve(relative_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("wb") as output:
            while chunk := await upload.read(1024 * 1024):
                output.write(chunk)
        return relative_path

    def write_bytes(self, relative_path: str, data: bytes) -> str:
        destination = self._resolve(relative_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        return normalize_key(relative_path)

    def read_bytes(self, relative_path: str) -> bytes:
        return self._resolve(relative_path).read_bytes()

    def delete(self, relative_path: str) -> None:
        target = self._resolve(relative_path)
        if target.exists():
            target.unlink()

    def exists(self, relative_path: str) -> bool:
        return self._resolve(relative_path).exists()

    def path(self, relative_path: str) -> Path:
        return self._resolve(relative_path)

    def url_for(self, relative_path: str, *, expires_in: int = 900, filename: str | None = None) -> str | None:
        """No signed URL for local disk — callers fall back to streaming."""

        self._resolve(relative_path)
        return None

    def open_stream(self, relative_path: str) -> BinaryIO:
        return self._resolve(relative_path).open("rb")


class S3Storage:
    """S3-compatible backend (AWS S3, MinIO, R2, ...)."""

    backend = "s3"

    def __init__(
        self,
        bucket: str | None = None,
        *,
        prefix: str | None = None,
        region: str | None = None,
        endpoint_url: str | None = None,
        sse: str | None = None,
        sse_kms_key_id: str | None = None,
    ) -> None:
        settings = get_settings()
        self.bucket = bucket or settings.s3_bucket
        if not self.bucket:
            raise RuntimeError("S3_BUCKET must be set when STORAGE_BACKEND=s3")
        self.prefix = (prefix if prefix is not None else settings.s3_prefix or "").strip("/")
        self.region = region or settings.s3_region
        self.endpoint_url = endpoint_url or settings.s3_endpoint_url
        self.sse = sse if sse is not None else settings.s3_server_side_encryption
        self.sse_kms_key_id = sse_kms_key_id if sse_kms_key_id is not None else settings.s3_sse_kms_key_id
        self._client = None

    # -- internals -----------------------------------------------------
    @property
    def client(self):
        if self._client is None:
            try:
                import boto3  # imported lazily: optional dependency
            except ImportError as exc:  # pragma: no cover - depends on env
                raise RuntimeError(
                    "STORAGE_BACKEND=s3 requires boto3 (pip install boto3)"
                ) from exc
            self._client = boto3.client(
                "s3",
                region_name=self.region,
                endpoint_url=self.endpoint_url,
            )
        return self._client

    def _object_key(self, relative_path: str) -> str:
        key = normalize_key(relative_path)
        return f"{self.prefix}/{key}" if self.prefix else key

    def _encryption_args(self) -> dict[str, str]:
        if not self.sse:
            return {}
        args = {"ServerSideEncryption": self.sse}
        if self.sse.lower() == "aws:kms" and self.sse_kms_key_id:
            args["SSEKMSKeyId"] = self.sse_kms_key_id
        return args

    # -- storage API ---------------------------------------------------
    async def save_upload(self, upload: UploadFile, folder: str, filename: str | None = None) -> str:
        name = filename or f"{uuid4()}-{upload.filename or 'upload.bin'}"
        relative_path = normalize_key(f"{folder.strip('/')}/{Path(name).name}")
        data = await upload.read()
        self.write_bytes(relative_path, data)
        return relative_path

    def write_bytes(self, relative_path: str, data: bytes) -> str:
        self.client.put_object(
            Bucket=self.bucket,
            Key=self._object_key(relative_path),
            Body=data,
            **self._encryption_args(),
        )
        return normalize_key(relative_path)

    def read_bytes(self, relative_path: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=self._object_key(relative_path))
        return response["Body"].read()

    def delete(self, relative_path: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self._object_key(relative_path))

    def exists(self, relative_path: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=self._object_key(relative_path))
            return True
        except Exception:
            return False

    def path(self, relative_path: str) -> Path:
        raise NotImplementedError(
            "S3Storage has no local filesystem path; use url_for() or open_stream()"
        )

    def url_for(self, relative_path: str, *, expires_in: int = 900, filename: str | None = None) -> str | None:
        params = {"Bucket": self.bucket, "Key": self._object_key(relative_path)}
        if filename:
            params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'
        return self.client.generate_presigned_url(
            "get_object", Params=params, ExpiresIn=expires_in
        )

    def open_stream(self, relative_path: str) -> BinaryIO:
        response = self.client.get_object(Bucket=self.bucket, Key=self._object_key(relative_path))
        return response["Body"]


def build_storage():
    settings = get_settings()
    backend = (getattr(settings, "storage_backend", "local") or "local").lower()
    if backend == "s3":
        return S3Storage()
    if backend != "local":
        logger.warning("storage.unknown_backend", extra={"backend": backend})
    return LocalStorage()


storage = build_storage()
