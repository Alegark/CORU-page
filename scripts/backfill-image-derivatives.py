#!/usr/bin/env python3
"""Idempotently create CORU's responsive WebP media variants.

The script deliberately reads the public catalog and writes only additional
objects under ``products/<product>/variants/<image>/<variant>.webp``. It never
deletes or replaces an original. A deployed media route is used as the cheap
existence check so re-running the command is safe after an interrupted upload.

The repository's bundled Python runtime includes Pillow. Example on Windows:

  & "$env:LOCALAPPDATA\\...\\python.exe" scripts/backfill-image-derivatives.py

Use ``--dry-run`` to validate the catalog and generated sizes without calling
Wrangler.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

try:
    from PIL import Image, ImageOps
except ImportError as exc:  # pragma: no cover - exercised by operator setup
    raise SystemExit("Pillow es necesario. Usa el Python empaquetado por Codex o instala Pillow.") from exc


VARIANTS: tuple[tuple[str, int], ...] = (
    ("thumb-320", 320),
    ("thumb-640", 640),
    ("detail-1200", 1200),
)
MEDIA_CACHE = "public, max-age=31536000, immutable"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.environ.get("CORU_BASE_URL", "https://coru.systems"), help="URL pública del Worker")
    parser.add_argument("--bucket", default=os.environ.get("CORU_MEDIA_BUCKET", "coru-media-production"), help="Bucket R2 remoto")
    parser.add_argument("--dry-run", action="store_true", help="Genera y valida archivos pero no sube a R2")
    parser.add_argument("--force", action="store_true", help="Regenera y sobrescribe las variantes existentes")
    parser.add_argument("--workers", type=int, default=6, help="Subidas de Wrangler simultáneas (por defecto: 6)")
    return parser.parse_args()


def get_json(url: str) -> dict:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "coru-media-backfill/1"})
    with urlopen(request, timeout=45) as response:
        return json.load(response)


def remote_variant_exists(url: str, variant: str) -> bool:
    request = Request(url, method="HEAD", headers={"User-Agent": "coru-media-backfill/1"})
    try:
        with urlopen(request, timeout=20) as response:
            return response.status == 200 and response.headers.get("X-Coru-Media-Variant") == variant
    except (HTTPError, URLError):
        return False


def download(url: str) -> bytes:
    request = Request(url, headers={"Accept": "image/*", "User-Agent": "coru-media-backfill/1"})
    with urlopen(request, timeout=90) as response:
        body = response.read()
        if not body:
            raise RuntimeError(f"respuesta vacía: {url}")
        return body


def write_variant(source: bytes, output: Path, width: int) -> int:
    with Image.open(__import__("io").BytesIO(source)) as image:
        image = ImageOps.exif_transpose(image)
        image.thumbnail((width, width), Image.Resampling.LANCZOS)
        if output.suffix.lower() == ".jpg":
            background = Image.new("RGB", image.size, (255, 255, 255))
            if image.mode in ("RGBA", "LA"):
                background.paste(image, mask=image.getchannel("A"))
            else:
                background.paste(image.convert("RGB"))
            background.save(output, format="JPEG", quality=85, optimize=True)
        else:
            mode = "RGBA" if "A" in image.getbands() else "RGB"
            image.convert(mode).save(output, format="WEBP", quality=82, method=6)
    return output.stat().st_size


def upload(local_path: Path, bucket: str, key: str) -> None:
    npx = shutil.which("npx.cmd" if os.name == "nt" else "npx") or ("npx.cmd" if os.name == "nt" else "npx")
    command = [
        npx,
        "--yes",
        "wrangler",
        "r2",
        "object",
        "put",
        f"{bucket}/{key}",
        "--file",
        str(local_path),
        "--content-type",
        "image/jpeg" if key.endswith(".jpg") else "image/webp",
        "--cache-control",
        MEDIA_CACHE,
        "--remote",
        "-y",
    ]
    result = subprocess.run(command, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(f"Wrangler no pudo subir {key}: {detail}")


def image_id_from_url(value: str) -> str:
    path = urlparse(value).path.rstrip("/")
    image_id = path.rsplit("/", 1)[-1]
    if not image_id:
        raise ValueError(f"URL de imagen sin id: {value}")
    return image_id


def main() -> int:
    args = parse_args()
    base_url = args.base_url.rstrip("/") + "/"
    catalog_url = urljoin(base_url, "api/catalog")
    print(f"Leyendo catálogo: {catalog_url}")
    payload = get_json(catalog_url)
    products = payload.get("data")
    if not isinstance(products, list):
        raise RuntimeError("/api/catalog no devolvió data[]")

    planned = uploaded = skipped = failed = 0
    upload_jobs: list[tuple[Path, str]] = []
    with tempfile.TemporaryDirectory(prefix="coru-media-backfill-") as temporary:
        temp_dir = Path(temporary)
        for product in products:
            if not isinstance(product, dict):
                continue
            product_id = str(product.get("id") or "")
            image_sources = product.get("imageSources") or []
            legacy_urls = product.get("imageUrls") or []
            images = image_sources if image_sources else [{"id": image_id_from_url(str(value)), "src": value} for value in legacy_urls]
            for image in images:
                if not isinstance(image, dict):
                    continue
                image_id = str(image.get("id") or "")
                source_value = image.get("src")
                if not product_id or not image_id or not isinstance(source_value, str):
                    failed += 1
                    print(f"[ERROR] registro de imagen inválido en {product_id}", file=sys.stderr)
                    continue
                source_url = urljoin(base_url, source_value)
                try:
                    source = download(source_url)
                    jobs = [(variant, width, "webp") for variant, width in VARIANTS]
                    jobs.append(("og-1200", 1200, "jpg"))
                    for variant, width, extension in jobs:
                        key = f"products/{product_id}/variants/{image_id}/{variant}.{extension}"
                        public_name = "og-1200.jpg" if variant == "og-1200" else f"{variant}.webp"
                        variant_url = urljoin(base_url, f"media/products/{image_id}/{public_name}")
                        if not args.force and remote_variant_exists(variant_url, variant):
                            skipped += 1
                            continue
                        planned += 1
                        local_path = temp_dir / f"{product_id}-{image_id}-{variant}.{extension}"
                        byte_size = write_variant(source, local_path, width)
                        print(f"[{('DRY-RUN' if args.dry_run else 'READY')}] {key} ({byte_size:,} bytes)")
                        if not args.dry_run:
                            upload_jobs.append((local_path, key))
                except Exception as exc:  # keep independent images progressing
                    failed += 1
                    print(f"[ERROR] {product_id}/{image_id}: {exc}", file=sys.stderr)

        if not args.dry_run and upload_jobs:
            workers = max(1, min(args.workers, len(upload_jobs)))
            with ThreadPoolExecutor(max_workers=workers) as executor:
                futures = {executor.submit(upload, local_path, args.bucket, key): key for local_path, key in upload_jobs}
                for future in as_completed(futures):
                    key = futures[future]
                    try:
                        future.result()
                        uploaded += 1
                    except Exception as exc:
                        failed += 1
                        print(f"[ERROR] {key}: {exc}", file=sys.stderr)

    print(f"Resumen: planificadas={planned}, subidas={uploaded}, omitidas={skipped}, errores={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
