from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.config import get_settings


class LocalStorage:
    def __init__(self, root: str | None = None) -> None:
        settings = get_settings()
        self.root = Path(root or settings.upload_dir).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, relative_path: str) -> Path:
        path = (self.root / relative_path).resolve()
        if self.root not in path.parents and path != self.root:
            raise ValueError("Invalid storage path")
        return path

    async def save_upload(self, upload: UploadFile, folder: str, filename: str | None = None) -> str:
        name = filename or f"{uuid4()}-{upload.filename or 'upload.bin'}"
        relative_path = f"{folder.strip('/')}/{name}"
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
        return relative_path

    def read_bytes(self, relative_path: str) -> bytes:
        return self._resolve(relative_path).read_bytes()

    def path(self, relative_path: str) -> Path:
        return self._resolve(relative_path)


storage = LocalStorage()

