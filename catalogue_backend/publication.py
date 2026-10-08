"""
Backend for the FDO Studio Publication tab.

Three endpoints, matching the lifecycle described in the pasted design:

  POST /publication/scan-repository  -> find candidate FDO assets in a
                                         GitHub repo (workflow/component/dataset)
  POST /publication/enrich           -> pre-fill type-specific metadata for
                                         one asset (from repo content or
                                         execution context)
  POST /publication/publish          -> build an RO-Crate per ready asset,
                                         assign a PID, write it to disk

Mount this into the existing FastAPI app with:

    from publication import router as publication_router
    app.include_router(publication_router)

Validation against required fields is intentionally NOT a network round
trip — the frontend already has the same field schema (src/fieldSchemas.ts)
and can compute "missingFields" instantly client-side. Keeping that
client-side avoids a redundant call on every keystroke.
"""

from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

try:
    from rocrate.rocrate import ROCrate
except ImportError:  # pragma: no cover - rocrate is a real dependency; this
    # just keeps the module importable in environments where it's missing,
    # so /scan-repository still works even if /publish can't.
    ROCrate = None  # type: ignore

router = APIRouter(prefix="/publication", tags=["publication"])

GITHUB_API_BASE = "https://api.github.com"
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")  # optional; raises the 60/hr unauthenticated rate limit to 5000/hr

CRATE_OUTPUT_DIR = Path(os.getenv("PUBLICATION_CRATE_DIR", "./published-crates"))

DATASET_EXTENSIONS = {
    ".csv", ".tsv", ".nc", ".tif", ".tiff", ".geojson", ".shp", ".zip", ".parquet"
}


# =====================================================
# Models
# =====================================================

class ScanRepositoryRequest(BaseModel):
    repo_url: str


class DetectedAsset(BaseModel):
    id: str
    title: str
    type: str  # "workflow" | "component" | "dataset"
    path: str
    size: Optional[int] = None


class ScanRepositoryResponse(BaseModel):
    owner: str
    repo: str
    ref: str
    assets: List[DetectedAsset]
    truncated: bool = False


class EnrichRequest(BaseModel):
    type: str  # "dataset" | "workflow" | "component"
    repo_url: Optional[str] = None
    path: Optional[str] = None
    title: Optional[str] = None


class EnrichResponse(BaseModel):
    metadata: Dict[str, Any]


class PublishAsset(BaseModel):
    id: str
    type: str
    title: str
    metadata: Dict[str, Any] = {}


class PublishRequest(BaseModel):
    assets: List[PublishAsset]


class PublishedAsset(BaseModel):
    id: str
    pid: str
    crate_path: str


class PublishResponse(BaseModel):
    published: List[PublishedAsset]


# =====================================================
# Repository scanning
# =====================================================

def parse_github_url(repo_url: str) -> tuple[str, str]:
    """Accepts things like 'https://github.com/owner/repo',
    'https://github.com/owner/repo.git', or 'owner/repo' directly."""
    cleaned = repo_url.strip()
    if cleaned.startswith("http://") or cleaned.startswith("https://"):
        parsed = urlparse(cleaned)
        parts = [p for p in parsed.path.split("/") if p]
    else:
        parts = [p for p in cleaned.split("/") if p]

    if len(parts) < 2:
        raise HTTPException(status_code=400, detail=f"Could not parse a GitHub owner/repo from: {repo_url}")

    owner, repo = parts[0], parts[1]
    if repo.endswith(".git"):
        repo = repo[: -len(".git")]
    return owner, repo


def github_headers() -> dict:
    headers = {"Accept": "application/vnd.github+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return headers


def fetch_default_branch(owner: str, repo: str) -> str:
    resp = requests.get(f"{GITHUB_API_BASE}/repos/{owner}/{repo}", headers=github_headers(), timeout=20)
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail=f"Repository {owner}/{repo} not found (or private).")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {resp.status_code} {resp.text}")
    return resp.json()["default_branch"]


def fetch_repo_tree(owner: str, repo: str, ref: str) -> tuple[List[dict], bool]:
    resp = requests.get(
        f"{GITHUB_API_BASE}/repos/{owner}/{repo}/git/trees/{ref}",
        params={"recursive": "1"},
        headers=github_headers(),
        timeout=30,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {resp.status_code} {resp.text}")
    data = resp.json()
    return data.get("tree", []), bool(data.get("truncated", False))


def classify_path(path: str) -> Optional[str]:
    """Returns 'workflow' | 'component' | 'dataset' | None (not a candidate)."""
    lower = path.lower()

    if lower.endswith(".naavrewf"):
        return "workflow"

    if re.search(r"(^|/)components?/.*\.json$", lower):
        return "component"

    if lower.startswith("data/") or "/data/" in lower:
        if Path(lower).suffix in DATASET_EXTENSIONS:
            return "dataset"

    if Path(lower).suffix in DATASET_EXTENSIONS:
        return "dataset"

    return None


@router.post("/scan-repository", response_model=ScanRepositoryResponse)
def scan_repository(payload: ScanRepositoryRequest) -> ScanRepositoryResponse:
    owner, repo = parse_github_url(payload.repo_url)
    ref = fetch_default_branch(owner, repo)
    tree, truncated = fetch_repo_tree(owner, repo, ref)

    assets: List[DetectedAsset] = []
    for entry in tree:
        if entry.get("type") != "blob":
            continue
        path = entry.get("path", "")
        kind = classify_path(path)
        if not kind:
            continue
        assets.append(
            DetectedAsset(
                id=f"repo-{entry.get('sha', uuid.uuid4().hex)[:12]}",
                title=Path(path).name,
                type=kind,
                path=path,
                size=entry.get("size"),
            )
        )

    return ScanRepositoryResponse(owner=owner, repo=repo, ref=ref, assets=assets, truncated=truncated)


# =====================================================
# Draft enrichment
# =====================================================

def fetch_raw_file(owner: str, repo: str, ref: str, path: str) -> Optional[str]:
    resp = requests.get(
        f"https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}",
        timeout=20,
    )
    if resp.status_code != 200:
        return None
    return resp.text


@router.post("/enrich", response_model=EnrichResponse)
def enrich_draft(payload: EnrichRequest) -> EnrichResponse:
    metadata: Dict[str, Any] = {}

    if payload.repo_url and payload.path:
        owner, repo = parse_github_url(payload.repo_url)
        ref = fetch_default_branch(owner, repo)
        content = fetch_raw_file(owner, repo, ref, payload.path)

        if payload.type == "workflow":
            # TODO(integration): delegate to the same builder /generate-fdo
            # already uses for workflow-level extraction (README, LICENSE,
            # notebook, .naavrewf parsing) instead of this minimal stub —
            # that logic already exists in catalogue_backend/app.py and
            # should be the single source of truth for workflow metadata.
            metadata["workflowFile"] = payload.path
            metadata["repositoryUrl"] = payload.repo_url
            if content:
                metadata["description"] = f"Workflow definition found at {payload.path}."

        elif payload.type == "component":
            import json as _json

            try:
                spec = _json.loads(content) if content else {}
            except ValueError:
                spec = {}
            metadata["title"] = spec.get("name") or payload.title
            metadata["description"] = spec.get("description", "")
            metadata["inputDatasetUrls"] = spec.get("inputs", [])
            metadata["dataflowConnections"] = spec.get("outputs", [])
            metadata["programmingLanguage"] = spec.get("language", "")
            metadata["runtimePlatform"] = spec.get("base_container", "")

        elif payload.type == "dataset":
            metadata["resourceLocator"] = (
                f"https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{payload.path}"
            )
            metadata["dataFormat"] = Path(payload.path).suffix.lstrip(".")

    return EnrichResponse(metadata=metadata)


# =====================================================
# Publish
# =====================================================

def build_crate_for_asset(asset: PublishAsset, pid: str) -> Path:
    if ROCrate is None:
        raise HTTPException(status_code=500, detail="rocrate package is not installed on the backend.")

    crate_dir = CRATE_OUTPUT_DIR / asset.id
    crate_dir.mkdir(parents=True, exist_ok=True)

    crate = ROCrate()
    crate.name = asset.title
    crate.datePublished = datetime.now(timezone.utc).isoformat()

    additional_type = {"dataset": "Dataset", "workflow": "ComputationalWorkflow", "component": "SoftwareApplication"}.get(
        asset.type, "CreativeWork"
    )

    root = crate.root_dataset
    root["name"] = asset.title
    root["additionalType"] = additional_type
    root["identifier"] = pid
    for key, value in asset.metadata.items():
        if value not in (None, "", []):
            root[key] = value

    crate.write(str(crate_dir))
    return crate_dir / "ro-crate-metadata.json"


@router.post("/publish", response_model=PublishResponse)
def publish_assets(payload: PublishRequest) -> PublishResponse:
    published: List[PublishedAsset] = []

    for asset in payload.assets:
        pid = f"urn:uuid:{uuid.uuid4()}"
        crate_path = build_crate_for_asset(asset, pid)
        published.append(PublishedAsset(id=asset.id, pid=pid, crate_path=str(crate_path)))

    return PublishResponse(published=published)
