from dotenv import load_dotenv
load_dotenv()

import xml.etree.ElementTree as ET
from requests.exceptions import RequestException

import math
import os
from typing import Any, Dict, List, Optional

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="LTER-LIFE Catalogue Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GEONETWORK_BASE_URL = os.getenv("GEONETWORK_BASE_URL", "https://lter-life-catalogue.qcdis.org/geonetwork")
GEONETWORK_PORTAL = os.getenv("GEONETWORK_PORTAL", "srv")
KEYCLOAK_AUTH_SERVER_URL = os.getenv("KEYCLOAK_AUTH_SERVER_URL", "https://lifewatch.lab.uvalight.net/auth")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "vre")
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "lter-life-catalogue-harvester")
KEYCLOAK_CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET")
KEYCLOAK_USERNAME = os.getenv("KEYCLOAK_USERNAME", "harvester-service-account")
KEYCLOAK_PASSWORD = os.getenv("KEYCLOAK_PASSWORD")

DEFAULT_PAGE_SIZE = 10
MAX_PAGE_SIZE = 100

session = requests.Session()
session.verify = False


class SearchRequest(BaseModel):
    query: str
    page: int = 1
    size: int = DEFAULT_PAGE_SIZE


def get_keycloak_token() -> str:
    if not KEYCLOAK_CLIENT_SECRET or not KEYCLOAK_PASSWORD:
        raise HTTPException(status_code=500, detail="Missing KEYCLOAK_CLIENT_SECRET or KEYCLOAK_PASSWORD.")
    token_url = f"{KEYCLOAK_AUTH_SERVER_URL.rstrip('/')}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/token"
    try:
        resp = requests.post(token_url, headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={"grant_type": "password", "client_id": KEYCLOAK_CLIENT_ID,
                  "client_secret": KEYCLOAK_CLIENT_SECRET, "username": KEYCLOAK_USERNAME,
                  "password": KEYCLOAK_PASSWORD}, timeout=20, verify=False)
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Keycloak token request failed: {e}")
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail=f"Keycloak token request failed: {resp.text}")
    token = resp.json().get("access_token")
    if not token:
        raise HTTPException(status_code=500, detail="Keycloak response did not contain an access token.")
    return token


def gn_headers(access_token: str) -> dict:
    try:
        session.get(f"{GEONETWORK_BASE_URL}/", timeout=10, allow_redirects=True)
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Cannot connect to GeoNetwork: {e}")
    xsrf = session.cookies.get("XSRF-TOKEN")
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
    if xsrf:
        headers["X-XSRF-TOKEN"] = xsrf
    return headers


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return " ".join(value.split()).strip()
    return " ".join(str(value).split()).strip()


def truncate_text(text: str, max_len: int = 1200) -> str:
    clean = normalize_text(text)
    if len(clean) <= max_len:
        return clean
    return clean[:max_len].rstrip() + "..."


def extract_total_hits(response_json: Dict[str, Any]) -> int:
    total_raw = response_json.get("hits", {}).get("total", 0)
    if isinstance(total_raw, int):
        return total_raw
    if isinstance(total_raw, dict):
        value = total_raw.get("value", 0)
        if isinstance(value, int):
            return value
    return 0


def safe_get_nested(data: Any, path: List[str], default: str = "") -> str:
    current = data
    for key in path:
        if not isinstance(current, dict):
            return default
        current = current.get(key)
        if current is None:
            return default
    return normalize_text(current) or default


def find_first_value_by_keys(data: Any, candidate_keys: set[str]) -> str:
    if isinstance(data, dict):
        for key, value in data.items():
            if key in candidate_keys:
                if isinstance(value, str) and value.strip():
                    return normalize_text(value)
                if isinstance(value, dict):
                    default_value = value.get("default")
                    if isinstance(default_value, str) and default_value.strip():
                        return normalize_text(default_value)
                if isinstance(value, list):
                    for item in value:
                        if isinstance(item, str) and item.strip():
                            return normalize_text(item)
                        if isinstance(item, dict):
                            dv = item.get("default") or item.get("@value")
                            if isinstance(dv, str) and dv.strip():
                                return normalize_text(dv)
            found = find_first_value_by_keys(value, candidate_keys)
            if found:
                return found
    elif isinstance(data, list):
        for item in data:
            found = find_first_value_by_keys(item, candidate_keys)
            if found:
                return found
    return ""


NAMESPACES = {
    "gmd": "http://www.isotc211.org/2005/gmd",
    "gco": "http://www.isotc211.org/2005/gco",
    "gmx": "http://www.isotc211.org/2005/gmx",
    "mdb": "http://standards.iso.org/iso/19115/-3/mdb/2.0",
    "mri": "http://standards.iso.org/iso/19115/-3/mri/1.0",
    "cit": "http://standards.iso.org/iso/19115/-3/cit/2.0",
    "lan": "http://standards.iso.org/iso/19115/-3/lan/1.0",
    "gcx": "http://standards.iso.org/iso/19115/-3/gcx/1.0",
}


def fetch_full_record_xml_by_uuid(uuid: str, access_token: str) -> Optional[str]:
    if not uuid:
        return None
    record_url = f"{GEONETWORK_BASE_URL}/{GEONETWORK_PORTAL}/api/records/{uuid}"
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/xml"}
    xsrf = session.cookies.get("XSRF-TOKEN")
    if xsrf:
        headers["X-XSRF-TOKEN"] = xsrf
    try:
        resp = session.get(record_url, headers=headers, timeout=30)
    except RequestException:
        return None
    if resp.status_code != 200:
        return None
    return resp.text


def get_first_nonempty_text(elements) -> str:
    for el in elements:
        if el is None:
            continue
        text = normalize_text("".join(el.itertext()).strip())
        if text:
            return text
    return ""


def extract_description_from_xml(xml_text: str) -> str:
    if not xml_text:
        return ""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return ""
    for xpath in [".//gmd:abstract/gco:CharacterString", ".//gmd:abstract/gmx:Anchor",
                  ".//gmd:identificationInfo//gmd:abstract/gco:CharacterString"]:
        value = get_first_nonempty_text(root.findall(xpath, NAMESPACES))
        if value:
            return truncate_text(value)
    for xpath in [".//mri:abstract/lan:PT_FreeText//lan:LocalisedCharacterString",
                  ".//mri:abstract/gco:CharacterString", ".//mri:abstract/gcx:Anchor"]:
        value = get_first_nonempty_text(root.findall(xpath, NAMESPACES))
        if value:
            return truncate_text(value)
    return ""


def extract_title_from_xml(xml_text: str) -> str:
    if not xml_text:
        return ""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return ""
    for xpath in [".//gmd:title/gco:CharacterString", ".//gmd:title/gmx:Anchor",
                  ".//cit:title/gco:CharacterString", ".//cit:title/gcx:Anchor"]:
        value = get_first_nonempty_text(root.findall(xpath, NAMESPACES))
        if value:
            return value
    return ""


def extract_org_from_xml(xml_text: str) -> str:
    if not xml_text:
        return ""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return ""
    for xpath in [".//gmd:organisationName/gco:CharacterString", ".//gmd:organisationName/gmx:Anchor",
                  ".//cit:party//cit:name/gco:CharacterString", ".//cit:party//cit:name/gcx:Anchor"]:
        value = get_first_nonempty_text(root.findall(xpath, NAMESPACES))
        if value:
            return value
    return ""


def extract_title_from_full_record(record_json: Dict[str, Any]) -> str:
    for path in [["metadata", "resourceTitleObject", "default"], ["resourceTitleObject", "default"],
                 ["metadata", "title"], ["title"]]:
        value = safe_get_nested(record_json, path)
        if value:
            return value
    fallback = find_first_value_by_keys(record_json, {"resourceTitle", "resourceTitleObject", "title", "name"})
    return fallback or "Untitled record"


def extract_org_from_full_record(record_json: Dict[str, Any]) -> str:
    for path in [["metadata", "orgNameObject", "default"], ["orgNameObject", "default"],
                 ["metadata", "organisation"], ["organisation"], ["owner"]]:
        value = safe_get_nested(record_json, path)
        if value:
            return value
    return find_first_value_by_keys(record_json, {"orgName", "orgNameObject", "organisation",
                                                   "organisationName", "owner", "publisher"})


def enrich_hit_with_full_record(hit: Dict[str, Any], headers: Dict[str, str], access_token: str) -> Dict[str, Any]:
    source = hit.get("_source", {}) or {}
    uuid = normalize_text(source.get("uuid"))
    title = (normalize_text(source.get("title")) or
             safe_get_nested(source, ["resourceTitleObject", "default"]) or "Untitled record")
    description = (normalize_text(source.get("description")) or
                   safe_get_nested(source, ["resourceAbstractObject", "default"]) or
                   normalize_text(source.get("abstract")))
    organisation = (normalize_text(source.get("organisation")) or
                    safe_get_nested(source, ["orgNameObject", "default"]) or
                    normalize_text(source.get("owner")))
    if uuid and (not description or description == "No description available."):
        xml_text = fetch_full_record_xml_by_uuid(uuid, access_token)
        if xml_text:
            if not description:
                description = extract_description_from_xml(xml_text)
            if not title or title == "Untitled record":
                title = extract_title_from_xml(xml_text) or title
            if not organisation:
                organisation = extract_org_from_xml(xml_text)
    source["uuid"] = uuid
    source["title"] = title or "Untitled record"
    source["description"] = description or "No description available."
    source["organisation"] = organisation or ""
    hit["_source"] = source
    return hit


def enrich_hits_with_full_records(hits: List[Dict[str, Any]], headers: Dict[str, str],
                                   access_token: str) -> List[Dict[str, Any]]:
    return [enrich_hit_with_full_record(hit, headers, access_token) for hit in hits]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/search")
def search_catalogue(payload: SearchRequest):
    query = payload.query.strip()
    page = max(payload.page, 1)
    size = max(1, min(payload.size, MAX_PAGE_SIZE))
    offset = (page - 1) * size
    if not query:
        return {"page": page, "size": size, "total": 0, "total_pages": 0,
                "has_previous": False, "has_next": False, "hits": {"total": 0, "hits": []}}
    access_token = get_keycloak_token()
    headers = gn_headers(access_token)
    search_url = f"{GEONETWORK_BASE_URL}/{GEONETWORK_PORTAL}/api/search/records/_search"
    body = {
        "from": offset, "size": size,
        "_source": {"includes": ["uuid", "id", "resourceTitleObject.default",
                                  "resourceAbstractObject.default", "orgNameObject.default",
                                  "title", "abstract", "description", "organisation", "owner"]},
        "query": {"bool": {"must": [{"query_string": {"query": query}}],
                           "filter": [{"term": {"isTemplate": {"value": "n"}}}]}}
    }
    try:
        resp = session.post(search_url, headers=headers, json=body, timeout=30)
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"GeoNetwork search request failed: {e}")
    if resp.status_code != 200:
        raise HTTPException(status_code=500, detail=f"GeoNetwork search failed: {resp.status_code} {resp.text}")
    data = resp.json()
    total = extract_total_hits(data)
    total_pages = math.ceil(total / size) if total > 0 else 0
    raw_hits = data.get("hits", {}).get("hits", [])
    enriched_hits = enrich_hits_with_full_records(raw_hits, headers, access_token)
    return {"page": page, "size": size, "total": total, "total_pages": total_pages,
            "has_previous": page > 1, "has_next": page < total_pages,
            "hits": {"total": data.get("hits", {}).get("total", total), "hits": enriched_hits}}


# =====================================================
# Full catalogue record fetch (Discovery -> Composition metadata carry-over)
# =====================================================
#
# /search deliberately restricts _source to a handful of display fields
# (title/description/organisation) to keep result cards light. When an
# asset is actually added to Composition we want the FULL record instead,
# mapped onto the same keys the Publication tab's Dataset schema uses
# (src/fieldSchemas.ts DATASET_SCHEMA), so metadata fetched here rides
# unchanged through Composition -> Execution -> Publication (the frontend
# store never copies items, only patches them in place).
#
# The mapping below is a best-effort first pass: GeoNetwork's ES field
# names for keywords/format/temporal/spatial extent vary by version and
# metadata profile. If a field below comes back empty for a real record,
# fetch that record once with the _source restriction removed (see
# get_catalogue_record) and inspect the raw JSON to find the actual key,
# then add it to the relevant candidate set.

def extract_keywords_from_source(source: Dict[str, Any]) -> List[str]:
    raw = source.get("tag") or source.get("keyword") or source.get("keywordValue") or []
    if isinstance(raw, str):
        raw = [raw]
    keywords: List[str] = []
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, str) and item.strip():
                keywords.append(normalize_text(item))
            elif isinstance(item, dict):
                value = item.get("default") or item.get("value")
                if isinstance(value, str) and value.strip():
                    keywords.append(normalize_text(value))
    return keywords


def extract_topic_category_from_source(source: Dict[str, Any]) -> str:
    raw = source.get("topicCat") or source.get("topicCategory")
    if isinstance(raw, list) and raw:
        return normalize_text(raw[0])
    if isinstance(raw, str):
        return normalize_text(raw)
    return ""


def extract_format_from_source(source: Dict[str, Any]) -> str:
    raw = source.get("format") or source.get("distributionFormat")
    if isinstance(raw, list) and raw:
        first = raw[0]
        if isinstance(first, str):
            return normalize_text(first)
        if isinstance(first, dict):
            return normalize_text(first.get("default") or first.get("name") or "")
    if isinstance(raw, str):
        return normalize_text(raw)
    return ""


def extract_temporal_extent_from_source(source: Dict[str, Any]) -> tuple[str, str]:
    raw = source.get("resourceTemporalDateRange") or source.get("temporalExtentDateRange")
    if isinstance(raw, list) and raw:
        raw = raw[0]
    if isinstance(raw, dict):
        begin = raw.get("gte") or raw.get("start") or raw.get("begin") or ""
        end = raw.get("lte") or raw.get("end") or ""
        return normalize_text(begin)[:10], normalize_text(end)[:10]
    begin = source.get("tempExtentBegin") or source.get("resourceTemporalExtentDateRangeBegin") or ""
    end = source.get("tempExtentEnd") or source.get("resourceTemporalExtentDateRangeEnd") or ""
    return normalize_text(begin)[:10], normalize_text(end)[:10]


def extract_bbox_from_source(source: Dict[str, Any]) -> str:
    raw = source.get("geom") or source.get("geoBox") or source.get("geographicBoundingBox")
    if isinstance(raw, list) and raw:
        raw = raw[0]
    if isinstance(raw, dict):
        west = raw.get("minx") or raw.get("west") or raw.get("westBoundLongitude")
        east = raw.get("maxx") or raw.get("east") or raw.get("eastBoundLongitude")
        south = raw.get("miny") or raw.get("south") or raw.get("southBoundLatitude")
        north = raw.get("maxy") or raw.get("north") or raw.get("northBoundLatitude")
        if all(v is not None for v in (west, east, south, north)):
            return f"W {west}, E {east}, S {south}, N {north}"
    return ""


def extract_license_from_source(source: Dict[str, Any]) -> str:
    return find_first_value_by_keys(
        source,
        {"MD_LegalConstraintsUseLimitation", "useLimitation", "license", "accessConstraints",
         "otherConstraints", "resourceConstraints"},
    )


def map_geonetwork_source_to_dataset_metadata(source: Dict[str, Any], record_uuid: str) -> Dict[str, Any]:
    """Maps one full GeoNetwork search-index _source document onto the
    DATASET_SCHEMA field keys from src/fieldSchemas.ts."""
    title = (normalize_text(source.get("title")) or
             safe_get_nested(source, ["resourceTitleObject", "default"]) or "Untitled record")
    description = (normalize_text(source.get("description")) or
                    safe_get_nested(source, ["resourceAbstractObject", "default"]) or
                    normalize_text(source.get("abstract")))
    organisation = (normalize_text(source.get("organisation")) or
                     safe_get_nested(source, ["orgNameObject", "default"]) or
                     normalize_text(source.get("owner")))
    contact_email = find_first_value_by_keys(
        source, {"contactEmail", "contactForResourceEmail", "userEmail", "email"}
    )
    begin, end = extract_temporal_extent_from_source(source)
    change_date = normalize_text(source.get("changeDate") or source.get("dateStamp"))

    return {
        "metadataContactOrganisation": organisation,
        "metadataContactEmail": contact_email,
        "metadataDate": change_date[:10] if change_date else "",
        "metadataLanguage": normalize_text(source.get("mainLanguage") or source.get("language")),

        "resourceTitle": title,
        "resourceLocator": f"{GEONETWORK_BASE_URL}/{GEONETWORK_PORTAL}/api/records/{record_uuid}",
        "resourceAbstract": description,
        "resourceType": find_first_value_by_keys(source, {"resourceType", "hierarchyLevel"}) or "dataset",
        "resourceUniqueIdentifier": record_uuid,
        "topicCategory": extract_topic_category_from_source(source),
        "freeKeywords": extract_keywords_from_source(source),

        "geographicBoundingBox": extract_bbox_from_source(source),
        "temporalExtentBegin": begin,
        "temporalExtentEnd": end,

        "dataFormat": extract_format_from_source(source),
        "conditionsForAccessAndUse": extract_license_from_source(source),

        "responsiblePartyOrganisation": organisation,
        "responsiblePartyEmail": contact_email,
    }


@app.get("/catalogue/record/{record_uuid}")
def get_catalogue_record(record_uuid: str):
    """Fetches the FULL GeoNetwork record for one uuid (no _source
    restriction, unlike /search) and maps it onto Dataset FDO fields.
    Called by the frontend right when an asset is added to Composition, so
    the rich metadata is captured once and carried forward from then on."""
    access_token = get_keycloak_token()
    headers = gn_headers(access_token)
    search_url = f"{GEONETWORK_BASE_URL}/{GEONETWORK_PORTAL}/api/search/records/_search"
    body = {
        "from": 0, "size": 1,
        "query": {"bool": {"filter": [{"term": {"uuid": record_uuid}}]}},
    }
    try:
        resp = session.post(search_url, headers=headers, json=body, timeout=30)
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"GeoNetwork lookup failed: {e}")
    if resp.status_code != 200:
        raise HTTPException(status_code=500, detail=f"GeoNetwork lookup failed: {resp.status_code} {resp.text}")

    hits = resp.json().get("hits", {}).get("hits", [])
    if not hits:
        raise HTTPException(status_code=404, detail=f"No catalogue record found for uuid {record_uuid}")

    source = hits[0].get("_source", {}) or {}
    metadata = map_geonetwork_source_to_dataset_metadata(source, record_uuid)
    return {"metadata": metadata, "type": "dataset"}


# =====================================================
# FDO Generation
# =====================================================
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from rocrate.rocrate import ROCrate
from rocrate.model.entity import Entity

KERNEL_TO_LANGUAGE = {
    "IRkernel": "R", "ir": "R",
    "python3": "Python", "ipykernel": "Python",
    "julia-1.x": "Julia", "julia": "Julia",
    "bash": "Bash",
}

LICENSE_MAP = {
    "apache": "https://www.apache.org/licenses/LICENSE-2.0",
    "apache-2": "https://www.apache.org/licenses/LICENSE-2.0",
    "apache 2": "https://www.apache.org/licenses/LICENSE-2.0",
    "mit": "https://opensource.org/licenses/MIT",
    "gpl": "https://www.gnu.org/licenses/gpl-3.0.html",
    "cc-by": "https://creativecommons.org/licenses/by/4.0/",
    "cc by": "https://creativecommons.org/licenses/by/4.0/",
}


class FDORequest(BaseModel):
    workflow_path: str
    title: Optional[str] = None
    description: Optional[str] = None
    author: Optional[str] = None


# ─── README enrichment ────────────────────────────────────────────────────────

def parse_readme(readme_path: str) -> Dict[str, Any]:
    result = {"title": "", "description": "", "keywords": [], "purpose": "", "license_url": ""}
    if not os.path.exists(readme_path):
        return result
    with open(readme_path, "r") as f:
        text = f.read()

    title_match = re.search(r'^#\s+(.+)', text, re.MULTILINE)
    if title_match:
        result["title"] = title_match.group(1).strip()

    paragraphs = [p.strip() for p in re.split(r'\n{2,}', text) if p.strip()]
    for para in paragraphs:
        if not para.startswith('#') and not para.startswith('-') and len(para) > 40:
            result["description"] = para.replace('\n', ' ').strip()
            break

    kw_match = re.search(r'###\s*Keywords\s*\n((?:[-*]\s*.+\n?)+)', text, re.IGNORECASE)
    if kw_match:
        result["keywords"] = [
            re.sub(r'^[-*]\s*', '', line).strip()
            for line in kw_match.group(1).strip().split('\n')
            if line.strip()
        ]

    purpose_match = re.search(
        r'([^.]*(?:goal|aim|purpose|objective|developing|enables)[^.]*\.)',
        text, re.IGNORECASE
    )
    if purpose_match:
        result["purpose"] = purpose_match.group(1).strip()

    return result


def parse_license(license_path: str) -> str:
    if not os.path.exists(license_path):
        return ""
    with open(license_path, "r") as f:
        text = f.read().lower()
    for key, url in LICENSE_MAP.items():
        if key in text:
            return url
    return ""


# ─── Notebook enrichment ──────────────────────────────────────────────────────

def parse_notebook(notebook_path: str) -> Dict[str, Any]:
    result = {
        "cell_descriptions": {},
        "actual_params": {},
        "temporal_coverage": {},
        "geographic_scope": "",
        "input_datasets": [],
        "software_requirements": [],
    }
    if not os.path.exists(notebook_path):
        return result

    with open(notebook_path, "r") as f:
        nb = json.load(f)

    cells = nb.get("cells", [])

    for cell in cells:
        source = "".join(cell.get("source", []))

        first_comment = re.search(r'^#\s*([^\n=]+)\n', source)
        if first_comment:
            label = first_comment.group(1).strip()
            if label not in ("Params", "Install and load all packages"):
                result["cell_descriptions"][label] = label

        param_matches = re.findall(
            r"(param_\w+)\s*=(?!=)\s*['\"]?([^'\"#\n]+)['\"]?", source
        )
        for name, value in param_matches:
            result["actual_params"][name.strip()] = value.strip()

        date_params = {k: v for k, v in result["actual_params"].items()
                       if "date" in k.lower()}
        if date_params:
            dates = list(date_params.values())
            result["temporal_coverage"] = {
                "start": min(dates),
                "end": max(dates),
            }

        if "28992" in source or "RD New" in source:
            result["geographic_scope"] = "Veluwe, Netherlands (EPSG:28992, Dutch RD New)"
        if "natura2000" in source.lower() or "objectid == 4049" in source:
            if not result["geographic_scope"]:
                result["geographic_scope"] = "Veluwe Natura 2000 area, Netherlands"

        urls = re.findall(r'https?://[^\s\'")\]]+', source)
        for url in urls:
            if any(x in url for x in ["knmi", "pdok", "probos", "landis", "github"]):
                if url not in result["input_datasets"]:
                    result["input_datasets"].append(url)

        pkg_matches = re.findall(r'p_load\(([^)]+)\)', source)
        for pkg_list in pkg_matches:
            pkgs = [p.strip().strip('"\'') for p in pkg_list.split(',')]
            result["software_requirements"].extend(pkgs)

    return result


# ─── Main parser ──────────────────────────────────────────────────────────────

def parse_naavrewf(workflow_path: str) -> Dict[str, Any]:
    with open(workflow_path, "r") as f:
        data = json.load(f)

    chart = data.get("chart", {})
    nodes = chart.get("nodes", {})
    links = chart.get("links", {})

    workflow_dir = str(Path(workflow_path).parent)
    readme_data = parse_readme(os.path.join(workflow_dir, "README.md"))
    license_url = parse_license(os.path.join(workflow_dir, "LICENSE"))
    notebook_data = parse_notebook(
        os.path.join(workflow_dir, "Forest_landscape_model_runner.ipynb")
    )

    components = []
    for node_id, node in nodes.items():
        cell = node.get("properties", {}).get("cell", {})

        kernel = cell.get("kernel", "")
        language = KERNEL_TO_LANGUAGE.get(kernel, kernel)

        raw_title = cell.get("title", "")
        raw_desc = cell.get("description", "")
        # Pick the cell_description with the MOST overlapping words, not
        # just the first one with any word in common — several component
        # titles here share generic words like "creator", so first-match
        # was picking wrong labels (e.g. "scenario-file-creator" was
        # matching "EcoregionsMap creator" just because both contain
        # "creator"). Best-overlap correctly distinguishes them.
        title_words = {w for w in re.split(r"[\s\-_&]+", raw_title.lower()) if len(w) > 3}
        notebook_desc, best_score = "", 0
        for label in notebook_data["cell_descriptions"]:
            label_words = {w for w in re.split(r"[\s\-_&]+", label.lower()) if len(w) > 3}
            score = len(title_words & label_words)
            if score > best_score:
                best_score, notebook_desc = score, label
        description = notebook_desc or ("" if raw_desc == raw_title else raw_desc)

        container_image = cell.get("container_image", "")
        image_tag = container_image.split(":")[-1] if ":" in container_image else container_image

        params = cell.get("params", [])
        enriched_params = []
        for p in params:
            pname = p.get("name", "")
            actual_value = notebook_data["actual_params"].get(pname)
            enriched_params.append({
                "name": pname,
                "type": p.get("type", "str"),
                "default_value": p.get("default_value", ""),
                "actual_value": actual_value or p.get("default_value", ""),
            })

        cell_deps = [d["name"] for d in cell.get("dependencies", [])]
        nb_deps = notebook_data.get("software_requirements", [])
        all_deps = list(dict.fromkeys(cell_deps + nb_deps))

        components.append({
            "id": node_id,
            "title": raw_title,
            "description": description,
            "kernel": kernel,
            "language": language,
            "version": cell.get("version", 1),
            "owner": cell.get("owner", ""),
            "virtual_lab": cell.get("virtual_lab", ""),
            "container_image": container_image,
            "image_tag": image_tag,
            "base_container_image": cell.get("base_container_image") or {},
            "secrets": [x.get("name", "") for x in cell.get("secrets", [])],
            "confs": [x.get("name", "") for x in cell.get("confs", [])],
            "source_url": cell.get("source_url", ""),
            "inputs": cell.get("inputs", []),
            "outputs": cell.get("outputs", []),
            "params": enriched_params,
            "dependencies": all_deps,
            "created": cell.get("created", ""),
            "modified": cell.get("modified", ""),
        })

    connections = []
    for link_id, link in links.items():
        connections.append({
            "id": link_id,
            "from_node": link["from"]["nodeId"],
            "from_port": link["from"]["portId"],
            "to_node": link["to"]["nodeId"],
            "to_port": link["to"]["portId"],
        })

    return {
        "components": components,
        "connections": connections,
        "virtual_lab": components[0]["virtual_lab"] if components else "",
        "readme_title": readme_data.get("title", ""),
        "readme_description": readme_data.get("description", ""),
        "keywords": readme_data.get("keywords", []),
        "purpose": readme_data.get("purpose", ""),
        "license_url": license_url or "https://www.apache.org/licenses/LICENSE-2.0",
        "license_detected": license_url,
        "temporal_coverage": notebook_data.get("temporal_coverage", {}),
        "geographic_scope": notebook_data.get("geographic_scope", ""),
        "input_datasets": notebook_data.get("input_datasets", []),
    }


# ─── RO-Crate builder ─────────────────────────────────────────────────────────

def generate_ro_crate(
    workflow_data: Dict[str, Any],
    workflow_path: str,
    title: str,
    description: str,
    author: str,
    output_dir: str
) -> str:
    crate = ROCrate()

    final_title = title or workflow_data.get("readme_title") or "Veluwe Forest Landscape Model"
    final_desc = description or workflow_data.get("readme_description") or ""

    crate.root_dataset["name"] = final_title
    crate.root_dataset["description"] = final_desc
    crate.root_dataset["datePublished"] = datetime.now(timezone.utc).isoformat()
    crate.root_dataset["license"] = workflow_data.get("license_url",
        "https://www.apache.org/licenses/LICENSE-2.0")

    if workflow_data.get("keywords"):
        crate.root_dataset["keywords"] = ", ".join(workflow_data["keywords"])

    if workflow_data.get("purpose"):
        crate.root_dataset["abstract"] = workflow_data["purpose"]

    if workflow_data.get("geographic_scope"):
        crate.root_dataset["spatialCoverage"] = workflow_data["geographic_scope"]

    if workflow_data.get("temporal_coverage"):
        tc = workflow_data["temporal_coverage"]
        crate.root_dataset["temporalCoverage"] = f"{tc.get('start', '')}/{tc.get('end', '')}"

    if author:
        crate.root_dataset["author"] = {
            "@id": f"#author-{author.replace(' ', '-').lower()}",
            "@type": "Person",
            "name": author
        }

    wf_file = crate.add_file(
        workflow_path,
        dest_path="workflow-flm.naavrewf",
        properties={
            "name": Path(workflow_path).name,
            "encodingFormat": "application/json",
            "description": "NaaVRE workflow definition file"
        }
    )

    dataset_entities = []
    for ds_url in workflow_data.get("input_datasets", []):
        ds_id = f"#dataset-{re.sub(r'[^a-z0-9]', '-', ds_url.lower())[:40]}"
        ds_entity = crate.add(Entity(crate, ds_id, properties={
            "@type": "Dataset",
            "url": ds_url,
            "name": ds_url.split("/")[-1] or ds_url,
        }))
        dataset_entities.append(ds_entity)

    crate.root_dataset["hasPart"] = [wf_file] + dataset_entities

    component_entities = {}
    for comp in workflow_data["components"]:
        comp_id = f"#component-{comp['id']}"

        props = {
            "@type": ["SoftwareApplication", "HowToStep"],
            "name": comp["title"],
            "version": str(comp["version"]),
            "programmingLanguage": comp["language"],
            "softwareVersion": comp["image_tag"],
            "runtimePlatform": comp["container_image"],
            "url": comp["source_url"],
            "dateCreated": comp["created"],
            "dateModified": comp["modified"],
            "author": {
                "@id": f"#person-{comp['owner']}",
                "@type": "Person",
                "email": comp["owner"]
            },
            "input": [
                {"@id": f"#input-{i['name']}", "@type": "FormalParameter",
                 "name": i["name"], "additionalType": i["type"]}
                for i in comp["inputs"]
            ],
            "output": [
                {"@id": f"#output-{o['name']}", "@type": "FormalParameter",
                 "name": o["name"], "additionalType": o["type"]}
                for o in comp["outputs"]
            ],
            "softwareRequirements": comp["dependencies"],
        }

        if comp["description"]:
            props["description"] = comp["description"]

        if comp["params"]:
            props["variablesMeasured"] = [
                {
                    "@id": f"#param-{p['name']}",
                    "@type": "PropertyValue",
                    "name": p["name"],
                    "additionalType": p.get("type", "str"),
                    "defaultValue": p.get("default_value", ""),
                    "value": p.get("actual_value", p.get("default_value", "")),
                }
                for p in comp["params"]
            ]

        entity = crate.add(Entity(crate, comp_id, properties=props))
        component_entities[comp["id"]] = entity

    for conn in workflow_data["connections"]:
        conn_id = f"#connection-{conn['id']}"
        crate.add(Entity(crate, conn_id, properties={
            "@type": "DataFeed",
            "name": conn["from_port"],
            "description": f"{conn['from_port']} → {conn['to_port']}",
            "sourceOrganization": {"@id": f"#component-{conn['from_node']}"},
            "targetCollection": {"@id": f"#component-{conn['to_node']}"},
        }))

    Path(output_dir).mkdir(parents=True, exist_ok=True)
    crate.write(output_dir)
    return output_dir


@app.post("/generate-fdo")
def generate_fdo(payload: FDORequest):
    workflow_path = payload.workflow_path.strip()

    if not workflow_path:
        raise HTTPException(status_code=400, detail="workflow_path is required.")
    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404,
            detail=f"Workflow file not found: {workflow_path}")

    try:
        workflow_data = parse_naavrewf(workflow_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse workflow: {e}")

    title = payload.title or workflow_data.get("readme_title", "")
    description = payload.description or workflow_data.get("readme_description", "")
    author = payload.author or ""

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = f"/home/nafiseh/fdo-output/{Path(workflow_path).stem}_{timestamp}"

    try:
        crate_path = generate_ro_crate(
            workflow_data=workflow_data,
            workflow_path=workflow_path,
            title=title,
            description=description,
            author=author,
            output_dir=output_dir
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate RO-Crate: {e}")

    return {
        "status": "ok",
        "crate_path": crate_path,
        "workflow": Path(workflow_path).name,
        "components": len(workflow_data["components"]),
        "connections": len(workflow_data["connections"]),
        "virtual_lab": workflow_data["virtual_lab"],
        "keywords": workflow_data.get("keywords", []),
        "geographic_scope": workflow_data.get("geographic_scope", ""),
        "temporal_coverage": workflow_data.get("temporal_coverage", {}),
        "license": workflow_data.get("license_url", ""),
    }


# =====================================================
# Publication tab — repository scanning + draft FDOs
# =====================================================
#
# Three new endpoints for the Publication tab's "Assets from Repository"
# flow. These do NOT redefine parse_naavrewf / generate_ro_crate / parse_readme
# / parse_license / parse_notebook — they call the real versions above
# directly. The only new capability is fetching the relevant files from a
# GitHub repo into a temp directory first, so those existing functions can
# run against them exactly the way they already run against a local
# workflow_path.

import tempfile
import hashlib
import uuid as uuid_lib
from urllib.parse import urlparse

GITHUB_API_BASE = "https://api.github.com"
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")  # optional; 60/hr unauthenticated -> 5000/hr with a token
PUBLICATION_CRATE_DIR = os.getenv("PUBLICATION_CRATE_DIR", "/home/nafiseh/fdo-output/published-crates")
DATASET_EXTENSIONS = {".csv", ".tsv", ".nc", ".tif", ".tiff", ".geojson", ".shp", ".zip", ".parquet"}


class ScanRepositoryRequest(BaseModel):
    repo_url: str


class DetectedAsset(BaseModel):
    id: str
    internalPid: str
    pid: Optional[str] = None
    title: str
    type: str
    path: str
    size: Optional[int] = None


class EnrichRequest(BaseModel):
    type: str
    repo_url: Optional[str] = None
    path: Optional[str] = None
    title: Optional[str] = None


class PublishAsset(BaseModel):
    id: str
    internalPid: Optional[str] = None
    type: str
    title: str
    metadata: Dict[str, Any] = {}
    pid: Optional[str] = None


class PublishRequest(BaseModel):
    assets: List[PublishAsset]


class DiscoverRelationsRequest(BaseModel):
    asset: PublishAsset
    sources: List[str] = []  # any of: "repository", "workflow", "catalogue", "registry"


class SuggestedRelation(BaseModel):
    id: str
    internalPid: str

    subjectPid: Optional[str] = None
    subjectId: Optional[str] = None

    predicate: str

    objectPid: Optional[str] = None
    objectId: Optional[str] = None
    objectTitle: str

    discoveryMethod: str
    evidence: Optional[str] = None
    confidence: float = 0.5
    validationStatus: str = "proposed"


class DiscoverRelationsResponse(BaseModel):
    suggestions: List[SuggestedRelation]


class PreviewFdoRequest(BaseModel):
    asset: PublishAsset

def stable_internal_pid(*parts: Any) -> str:
    key = "::".join(str(p).strip() for p in parts if p is not None and str(p).strip())
    stable_uuid = uuid_lib.uuid5(uuid_lib.NAMESPACE_URL, key)
    return f"urn:uuid:{stable_uuid}"


def parse_github_url(repo_url: str):
    cleaned = repo_url.strip()
    if cleaned.startswith("http://") or cleaned.startswith("https://"):
        parts = [p for p in urlparse(cleaned).path.split("/") if p]
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


def fetch_repo_tree(owner: str, repo: str, ref: str):
    resp = requests.get(
        f"{GITHUB_API_BASE}/repos/{owner}/{repo}/git/trees/{ref}",
        params={"recursive": "1"}, headers=github_headers(), timeout=30,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {resp.status_code} {resp.text}")
    data = resp.json()
    return data.get("tree", []), bool(data.get("truncated", False))


def classify_path(path: str) -> Optional[str]:
    lower = path.lower()
    if lower.endswith(".naavrewf"):
        return "workflow"
    if re.search(r"(^|/)components?/.*\.json$", lower):
        return "component"
    if (lower.startswith("data/") or "/data/" in lower) and Path(lower).suffix in DATASET_EXTENSIONS:
        return "dataset"
    if Path(lower).suffix in DATASET_EXTENSIONS:
        return "dataset"
    return None


def download_repo_file(owner: str, repo: str, ref: str, path: str, dest_path: str) -> bool:
    resp = requests.get(f"https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}", timeout=20)
    if resp.status_code == 200:
        with open(dest_path, "wb") as f:
            f.write(resp.content)
        return True
    return False


def download_workflow_with_siblings(owner: str, repo: str, ref: str, workflow_path: str, tmp_dir: str) -> str:
    """Downloads the workflow file plus any README/LICENSE/notebook that
    live alongside it in the repo, so parse_naavrewf() finds them as
    siblings exactly like it does for a local workflow_path."""
    local_wf_path = os.path.join(tmp_dir, Path(workflow_path).name)
    if not download_repo_file(owner, repo, ref, workflow_path, local_wf_path):
        raise HTTPException(status_code=502, detail=f"Could not download {workflow_path} from {owner}/{repo}")

    workflow_dir = str(Path(workflow_path).parent)
    tree, _ = fetch_repo_tree(owner, repo, ref)
    for entry in tree:
        path = entry.get("path", "")
        if entry.get("type") != "blob" or str(Path(path).parent) != workflow_dir:
            continue
        name = Path(path).name
        if name.lower().startswith("readme") or name.lower().startswith("license") or name.lower().endswith(".ipynb"):
            download_repo_file(owner, repo, ref, path, os.path.join(tmp_dir, name))

    return local_wf_path


def extract_inline_assets_from_workflow(owner: str, repo: str, ref: str, workflow_path: str) -> List[DetectedAsset]:
    """A .naavrewf file embeds its own components as chart nodes, and
    parse_naavrewf() already pulls out any external dataset URLs the
    notebook references. Surface both as their own detected assets so the
    list isn't just the workflow file itself — exactly what shows up for
    VL-veluweFLM: 10 R components plus 3 external dataset URLs (KNMI,
    PDOK, Probos), none of which exist as separate files in the repo tree."""
    assets: List[DetectedAsset] = []
    try:
        with tempfile.TemporaryDirectory() as tmp:
            local_wf_path = download_workflow_with_siblings(owner, repo, ref, workflow_path, tmp)
            workflow_data = parse_naavrewf(local_wf_path)
    except HTTPException:
        return assets

    for comp in workflow_data.get("components", []):
        asset_id = f"repo-component-{comp['id'][:12]}"

        assets.append(DetectedAsset(
            id=asset_id,
            internalPid=stable_internal_pid(
                owner,
                repo,
                ref,
                workflow_path,
                "component",
                comp["id"],
            ),
            title=comp.get("title") or comp["id"],
            type="component",
            path=f"{workflow_path}::component::{comp['id']}",
        ))

    for ds_url in workflow_data.get("input_datasets", []):
        asset_id = f"repo-dataset-{hashlib.md5(ds_url.encode()).hexdigest()[:12]}"

        assets.append(DetectedAsset(
            id=asset_id,
            internalPid=stable_internal_pid(
                owner,
                repo,
                ref,
                workflow_path,
                "dataset",
                ds_url,
            ),
            title=ds_url.split("/")[-1] or ds_url,
            type="dataset",
            path=f"{ds_url}::from::{workflow_path}",
        ))

    return assets


def synthesize_component_description(comp: Dict[str, Any]) -> str:
    """The .naavrewf's description field is just a copy of the title (a
    slug, not real text) for every node here, and the notebook-comment
    heuristic doesn't always find a match. When there's nothing better,
    build a real, accurate sentence from the component's actual declared
    ports instead of leaving the field blank."""
    inputs = [i.get("name", "") for i in comp.get("inputs", [])]
    outputs = [o.get("name", "") for o in comp.get("outputs", [])]
    if inputs and outputs:
        return f"Takes {', '.join(inputs)} and produces {', '.join(outputs)}."
    if outputs:
        return f"Produces {', '.join(outputs)} (no declared inputs)."
    if inputs:
        return f"Consumes {', '.join(inputs)} (no declared outputs)."
    return ""


def format_temporal_range(temporal_coverage: Dict[str, Any]) -> str:
    if not temporal_coverage:
        return ""
    start, end = temporal_coverage.get("start", ""), temporal_coverage.get("end", "")
    if start and end:
        return f"{start} to {end}"
    return start or end or ""


def build_component_metadata(comp: Dict[str, Any], workflow_data: Dict[str, Any]) -> Dict[str, Any]:
    """Maps a parsed .naavrewf component onto the Component FDO fields,
    following the source mapping from the metadata coverage analysis.
    Fields marked '✗ Gap' there (model type/paradigm, assumptions,
    validation capabilities, etc.) have no extractable source and are
    intentionally left out — they need manual input either way."""
    params = comp.get("params", [])
    param_lookup = {p.get("name"): p for p in params}

    def param_value(name: str) -> str:
        p = param_lookup.get(name)
        if not p:
            return ""
        return p.get("actual_value") or p.get("default_value") or ""

    description = comp.get("description") or synthesize_component_description(comp)
    created = comp.get("created", "")

    return {
        # Domain Viewpoint
        "title": comp.get("title", ""),
        "description": description,
        "keywords": workflow_data.get("keywords", []),  # README ### Keywords — workflow-level, inherited
        "abstractPurpose": workflow_data.get("purpose", ""),  # README purpose sentence — inherited
        "purposeAndPattern": workflow_data.get("purpose", ""),
        "modelVersion": str(comp.get("version", "")),
        "authorsUniqueIdentifier": comp.get("owner", ""),  # email only — no ORCID in source
        "contributorRole": comp.get("owner", ""),  # same source — no CRediT taxonomy in source

        # Information Viewpoint
        "modelUniqueId": comp.get("id", ""),
        "parameterNames": [p.get("name", "") for p in params],
        "parameterDefaults": ", ".join(f"{p.get('name')}={p.get('default_value', '')}" for p in params),
        "parametersActualRun": ", ".join(
            f"{p.get('name')}={p.get('actual_value', p.get('default_value', ''))}" for p in params
        ),
        "infoInputDatasets": [i.get("name", "") for i in comp.get("inputs", [])],
        "output": [o.get("name", "") for o in comp.get("outputs", [])],
        "spatialCoverage": workflow_data.get("geographic_scope", ""),  # notebook EPSG/Natura2000 — inherited
        "temporalCoverage": format_temporal_range(workflow_data.get("temporal_coverage", {})),
        "timeStepsTemporalRes": param_value("param_timestep"),
        "spatialResolution": param_value("param_cell_length"),

        # Engineering Viewpoint
        "executionConstraints": ", ".join(comp.get("dependencies", [])),  # deps only, no real constraints in source

        # Technology Viewpoint
        "programmingLanguage": comp.get("language", ""),
        "availabilityOfSourceCode": comp.get("source_url", ""),
        "softwareRequirements": ", ".join(comp.get("dependencies", [])),
        "license": workflow_data.get("license_url", ""),  # repo LICENSE — inherited
        "distributionVersion": comp.get("image_tag", ""),
        "runtimePlatform": comp.get("container_image", ""),
        "dateCreatedModified": created[:10] if created else "",
        "dataflowConnections": [o.get("name", "") for o in comp.get("outputs", [])],
        "componentDescription": description,
        "inputDatasetUrls": workflow_data.get("input_datasets", []),  # notebook HTTP URLs — workflow-level, inherited
    }


def build_dataset_metadata_from_url(url: str, workflow_data: Dict[str, Any]) -> Dict[str, Any]:
    tc = workflow_data.get("temporal_coverage", {}) if workflow_data else {}
    return {
        "resourceTitle": url.split("/")[-1] or url,  # filename extracted from URL
        "resourceLocator": url,
        "resourceType": "Dataset",
        "resourceUniqueIdentifier": hashlib.md5(url.encode()).hexdigest(),  # auto-generated, not a formal PID
        "geographicBoundingBox": workflow_data.get("geographic_scope", "") if workflow_data else "",
        "temporalExtentBegin": tc.get("start", ""),
        "temporalExtentEnd": tc.get("end", ""),
        "dataFormat": Path(url).suffix.lstrip("."),
        "metadataDate": datetime.now().strftime("%Y-%m-%d"),  # FDO creation date, not the dataset's own date
    }


def build_dataset_metadata_from_repo_path(owner: str, repo: str, ref: str, path: str) -> Dict[str, Any]:
    return {
        "resourceTitle": Path(path).name,
        "resourceLocator": f"https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}",
        "resourceType": "Dataset",
        "resourceUniqueIdentifier": hashlib.md5(path.encode()).hexdigest(),
        "dataFormat": Path(path).suffix.lstrip("."),
        "metadataDate": datetime.now().strftime("%Y-%m-%d"),
    }


def compute_terminal_outputs(workflow_data: Dict[str, Any]) -> List[str]:
    """Output ports that are never consumed by another component — the
    workflow's actual final outputs. For VL-veluweFLM this comes back
    empty, correctly: the LANDIS-II runner has no declared outputs in the
    chart (it writes results to files/directories instead)."""
    consumed = {(c["from_node"], c["from_port"]) for c in workflow_data.get("connections", [])}
    terminal = []
    for comp in workflow_data.get("components", []):
        for o in comp.get("outputs", []):
            if (comp["id"], o.get("name")) not in consumed:
                terminal.append(o.get("name", ""))
    return terminal


def unique(values: List[Any]) -> List[Any]:
    return [v for v in dict.fromkeys(values) if v not in (None, "")]


def compute_step_order(workflow_data: Dict[str, Any]) -> List[str]:
    """Component titles in an order where every component comes after
    the ones it receives data from (several valid orders may exist)."""
    comps = {c["id"]: c for c in workflow_data.get("components", [])}
    upstream = {cid: set() for cid in comps}
    for conn in workflow_data.get("connections", []):
        if conn["from_node"] in comps and conn["to_node"] in comps:
            upstream[conn["to_node"]].add(conn["from_node"])
    order, placed = [], set()
    while len(order) < len(comps):
        ready = [cid for cid in comps if cid not in placed and upstream[cid] <= placed]
        if not ready:  # cycle in the chart: append the rest as they are
            ready = [cid for cid in comps if cid not in placed]
        for cid in ready:
            placed.add(cid)
            order.append(comps[cid].get("title") or cid)
    return order


def build_workflow_metadata(workflow_data: Dict[str, Any], ref: str, commit_sha: str) -> Dict[str, Any]:
    """Workflow-level fields that can be read from the parsed .naavrewf
    and its repository. Fields with no source here (ORCID, image digests,
    dependency versions, engine version, everything about a run) are left
    for manual input."""
    comps = workflow_data.get("components", [])
    titles = {c["id"]: c.get("title") or c["id"] for c in comps}
    connections = workflow_data.get("connections", [])
    consumed = {(c["to_node"], c["to_port"]) for c in connections}

    parameters: Dict[str, str] = {}
    for comp in comps:
        for p in comp.get("params", []):
            name = p.get("name", "")
            if name and name not in parameters:
                parameters[name] = f"{name} ({p.get('type', 'str')}) = {p.get('default_value', '')}"

    base_images = []
    for comp in comps:
        base = comp.get("base_container_image") or {}
        base_images.extend([base.get("build"), base.get("runtime")])

    created = sorted(c["created"] for c in comps if c.get("created"))
    modified = sorted(c["modified"] for c in comps if c.get("modified"))
    temporal = format_temporal_range(workflow_data.get("temporal_coverage", {}))

    return {
        "workflowType": "ComputationalWorkflow (Workflow RO-Crate)",
        "workflowLanguage": "NaaVRE workflow (.naavrewf)",
        "keywords": workflow_data.get("keywords", []),
        "purpose": workflow_data.get("purpose", ""),
        "virtualLab": workflow_data.get("virtual_lab", ""),
        "spatialCoverage": workflow_data.get("geographic_scope", ""),
        "temporalCoverage": temporal,
        "license": workflow_data.get("license_detected", ""),  # empty when the repo has no recognised LICENSE
        "creators": unique([c.get("owner") for c in comps]),  # emails only, no name or ORCID in source
        "version": commit_sha[:7] if re.fullmatch(r"[0-9a-f]{40}", commit_sha or "") else "",  # short commit; no release tag lookup
        "branch": ref,
        "dateCreated": created[0][:10] if created else "",
        "dateModified": modified[-1][:10] if modified else "",
        "parameters": "\n".join(parameters.values()),
        "connections": "\n".join(
            f"{titles.get(c['from_node'], c['from_node'])}.{c['from_port']} -> "
            f"{titles.get(c['to_node'], c['to_node'])}.{c['to_port']}"
            for c in connections
        ),
        "declaredInputs": unique([
            i.get("name", "") for comp in comps for i in comp.get("inputs", [])
            if (comp["id"], i.get("name")) not in consumed
        ]),
        "stepOrder": compute_step_order(workflow_data),
        "requiredSecrets": unique([n for comp in comps for n in comp.get("secrets", []) + comp.get("confs", [])]),
        "containerImages": unique([c.get("container_image") for c in comps]),
        "baseImages": unique(base_images),
        "languages": unique([c.get("language") for c in comps]),
        "dependencies": unique([d for comp in comps for d in comp.get("dependencies", [])]),  # names only
        "metadataDate": datetime.now().strftime("%Y-%m-%d"),
    }


def fetch_commit_sha(owner: str, repo: str, ref: str) -> str:
    resp = requests.get(f"{GITHUB_API_BASE}/repos/{owner}/{repo}/commits/{ref}", headers=github_headers(), timeout=20)
    if resp.status_code == 200:
        return resp.json().get("sha", ref)
    return ref


# ---- Relationship discovery (graph traversal over the real .naavrewf chart) ----

def find_producer_of_port(workflow_data: Dict[str, Any], port_name: str) -> Optional[Dict[str, Any]]:
    for comp in workflow_data.get("components", []):
        if any(o.get("name") == port_name for o in comp.get("outputs", [])):
            return comp
    return None


def find_root_sources(workflow_data: Dict[str, Any], comp: Dict[str, Any], visited: Optional[set] = None) -> List[Dict[str, Any]]:
    """Walks input ports back through their producers until it hits
    components with no further inputs — the workflow's original data
    sources. Used for 'derivedFrom', distinct from the immediate
    one-hop-back 'uses' relation."""
    visited = visited or set()
    if comp["id"] in visited:
        return []
    visited.add(comp["id"])
    if not comp.get("inputs"):
        return [comp]
    roots = []
    for inp in comp["inputs"]:
        upstream = find_producer_of_port(workflow_data, inp.get("name"))
        if upstream:
            roots.extend(find_root_sources(workflow_data, upstream, visited))
    return roots or [comp]


def compute_workflow_relations(workflow_data: Dict[str, Any], asset_type: str, ref_id: str) -> List[SuggestedRelation]:
    """ref_id is an output port name for a dataset/output asset, or a
    component node id for a component asset."""
    relations: List[SuggestedRelation] = []
    seen = set()

    def add(rel_type: str, target: str, source: str):
        key = (rel_type, target)
        if key not in seen:
            seen.add(key)
            relations.append(SuggestedRelation(type=rel_type, targetTitle=target, source=source))

    workflow_title = workflow_data.get("readme_title") or "Workflow"
    add("partOf", workflow_title, "workflow")

    if asset_type == "dataset":
        producer = find_producer_of_port(workflow_data, ref_id)
        if producer:
            add("producedBy", producer["title"], "workflow")
            for inp in producer.get("inputs", []):
                upstream = find_producer_of_port(workflow_data, inp.get("name"))
                if upstream:
                    add("uses", upstream["title"], "workflow")
            for root in find_root_sources(workflow_data, producer):
                if root["id"] != producer["id"]:
                    add("derivedFrom", root["title"], "workflow")
    elif asset_type == "component":
        comp = next((c for c in workflow_data.get("components", []) if c["id"] == ref_id), None)
        if comp:
            for inp in comp.get("inputs", []):
                upstream = find_producer_of_port(workflow_data, inp.get("name"))
                if upstream:
                    add("uses", upstream["title"], "workflow")
            for o in comp.get("outputs", []):
                add("produces", o.get("name", ""), "workflow")

    return relations


def search_catalogue_for_relations(query: str) -> List[SuggestedRelation]:
    if not query.strip():
        return []
    try:
        access_token = get_keycloak_token()
        headers = gn_headers(access_token)
        search_url = f"{GEONETWORK_BASE_URL}/{GEONETWORK_PORTAL}/api/search/records/_search"
        body = {
            "from": 0, "size": 3,
            "_source": {"includes": ["title", "resourceTitleObject.default"]},
            "query": {"bool": {"must": [{"query_string": {"query": query}}],
                                "filter": [{"term": {"isTemplate": {"value": "n"}}}]}}
        }
        resp = session.post(search_url, headers=headers, json=body, timeout=15)
        if resp.status_code != 200:
            return []
        hits = resp.json().get("hits", {}).get("hits", [])
        results = []
        for hit in hits:
            title = extract_title_from_full_record(hit.get("_source", {}))
            if title and title != "Untitled record":
                results.append(SuggestedRelation(type="relatedTo", targetTitle=title, source="catalogue"))
        return results
    except HTTPException:
        return []


def search_registry_for_relations(query: str) -> List[SuggestedRelation]:
    """Scans already-published crates on disk for title overlap. A real
    index/database would scale better than a directory scan, but there's
    no registry service yet — this is a genuine (if basic) search over
    what's actually been published so far, not a stub."""
    results = []
    crate_root = Path(PUBLICATION_CRATE_DIR)
    if not crate_root.exists() or not query.strip():
        return results
    query_words = {w for w in re.split(r"\W+", query.lower()) if len(w) > 3}
    for crate_file in crate_root.glob("*/ro-crate-metadata.json"):
        try:
            with open(crate_file) as f:
                data = json.load(f)
            root = next((e for e in data.get("@graph", []) if e.get("@id") == "./"), {})
            name = root.get("name", "")
            name_words = {w for w in re.split(r"\W+", name.lower()) if len(w) > 3}
            if query_words & name_words:
                results.append(SuggestedRelation(type="relatedTo", targetTitle=name, source="registry"))
        except (json.JSONDecodeError, OSError):
            continue
    return results[:3]


@app.post("/publication/discover-relations", response_model=DiscoverRelationsResponse)
def discover_relations(payload: DiscoverRelationsRequest):
    suggestions: List[SuggestedRelation] = []
    asset = payload.asset
    repo_url = asset.metadata.get("repositoryUrl")

    if repo_url and ("repository" in payload.sources or "workflow" in payload.sources):
        owner, repo = parse_github_url(repo_url)
        ref = fetch_default_branch(owner, repo)
        workflow_file = asset.metadata.get("workflowFile")
        ref_id = asset.metadata.get("modelUniqueId") or asset.metadata.get("sourceNodeId")
        if workflow_file and ref_id:
            with tempfile.TemporaryDirectory() as tmp:
                local_wf_path = download_workflow_with_siblings(owner, repo, ref, workflow_file, tmp)
                workflow_data = parse_naavrewf(local_wf_path)
            suggestions.extend(compute_workflow_relations(workflow_data, asset.type, ref_id))

    if "catalogue" in payload.sources:
        suggestions.extend(search_catalogue_for_relations(asset.title))

    if "registry" in payload.sources:
        suggestions.extend(search_registry_for_relations(asset.title))

    return DiscoverRelationsResponse(suggestions=suggestions)


@app.post("/publication/preview-fdo")
def preview_fdo(payload: PreviewFdoRequest):
    """Builds the same RO-Crate /publish would, but in a throwaway temp
    directory that's cleaned up immediately — nothing is kept or
    registered. Lets a scientist see the actual FDO before committing."""
    asset = payload.asset
    pid = asset.pid or asset.internalPid or f"urn:uuid:{uuid_lib.uuid4()} (preview only — not yet reserved)"
    repo_url = asset.metadata.get("repositoryUrl")
    workflow_file = asset.metadata.get("workflowFile")

    with tempfile.TemporaryDirectory() as tmp:
        if asset.type == "workflow" and repo_url and workflow_file:
            owner, repo = parse_github_url(repo_url)
            ref = fetch_default_branch(owner, repo)
            local_wf_path = download_workflow_with_siblings(owner, repo, ref, workflow_file, tmp)
            workflow_data = parse_naavrewf(local_wf_path)
            crate_dir = generate_ro_crate(
                workflow_data=workflow_data, workflow_path=local_wf_path,
                title=asset.metadata.get("workflowName") or asset.title,
                description=asset.metadata.get("description", ""), author="",
                output_dir=os.path.join(tmp, "preview-crate"),
            )
        else:
            crate_dir = os.path.join(tmp, "preview-crate")
            Path(crate_dir).mkdir(parents=True, exist_ok=True)
            crate = ROCrate()
            crate.root_dataset["name"] = asset.title
            crate.root_dataset["identifier"] = pid
            crate.root_dataset["additionalType"] = {
                "dataset": "Dataset", "component": "SoftwareApplication"
            }.get(asset.type, "CreativeWork")
            crate.root_dataset["datePublished"] = datetime.now(timezone.utc).isoformat()
            for key, value in asset.metadata.items():
                if value not in (None, "", []):
                    crate.root_dataset[key] = value
            crate.write(crate_dir)

        with open(os.path.join(crate_dir, "ro-crate-metadata.json")) as f:
            crate_json = json.load(f)

    return {"crate": crate_json, "pid": pid}


@app.post("/publication/scan-repository")
def scan_repository(payload: ScanRepositoryRequest):
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
        asset_id = f"repo-{entry.get('sha', uuid_lib.uuid4().hex)[:12]}"

        assets.append(DetectedAsset(
            id=asset_id,
            internalPid=stable_internal_pid(payload.repo_url, ref, path, kind),
            title=Path(path).name,
            type=kind,
            path=path,
            size=entry.get("size"),
        ))

    # Don't stop at the workflow file — look inside it too. A single
    # .naavrewf embeds its own components, and may reference external
    # datasets that never appear as files in the repo tree at all.
    for workflow_asset in [a for a in assets if a.type == "workflow"]:
        assets.extend(extract_inline_assets_from_workflow(owner, repo, ref, workflow_asset.path))

    return {"owner": owner, "repo": repo, "ref": ref, "truncated": truncated,
             "assets": [a.dict() for a in assets]}


@app.post("/publication/enrich")
def enrich_draft(payload: EnrichRequest):
    metadata: Dict[str, Any] = {}
    if not (payload.repo_url and payload.path):
        return {"metadata": metadata}

    owner, repo = parse_github_url(payload.repo_url)
    ref = fetch_default_branch(owner, repo)

    if payload.type == "workflow":
        with tempfile.TemporaryDirectory() as tmp:
            local_wf_path = download_workflow_with_siblings(owner, repo, ref, payload.path, tmp)
            try:
                workflow_data = parse_naavrewf(local_wf_path)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to parse workflow: {e}")

        metadata["workflowName"] = workflow_data.get("readme_title") or payload.title or Path(payload.path).stem
        metadata["description"] = workflow_data.get("readme_description", "")
        metadata["workflowFile"] = payload.path
        metadata["components"] = [c["title"] for c in workflow_data.get("components", [])]
        metadata["inputDatasets"] = workflow_data.get("input_datasets", [])
        metadata["outputDatasets"] = compute_terminal_outputs(workflow_data)
        metadata["repositoryUrl"] = payload.repo_url
        metadata["commitHash"] = fetch_commit_sha(owner, repo, ref)
        metadata["naavreVersion"] = ""
        metadata.update(build_workflow_metadata(workflow_data, ref, metadata["commitHash"]))

    elif payload.type == "component":
        if "::component::" in payload.path:
            # This component lives inside a .naavrewf chart, not as its own
            # components/*.json file — re-parse the workflow and map the
            # matching node onto the full Component FDO field set.
            workflow_path, _, node_id = payload.path.partition("::component::")
            with tempfile.TemporaryDirectory() as tmp:
                local_wf_path = download_workflow_with_siblings(owner, repo, ref, workflow_path, tmp)
                workflow_data = parse_naavrewf(local_wf_path)
            comp = next((c for c in workflow_data.get("components", []) if c["id"] == node_id), None)
            if comp:
                metadata.update(build_component_metadata(comp, workflow_data))
        else:
            resp = requests.get(f"https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{payload.path}", timeout=20)
            spec = {}
            if resp.status_code == 200:
                try:
                    spec = resp.json()
                except ValueError:
                    spec = {}
            metadata["title"] = spec.get("name") or payload.title
            metadata["description"] = spec.get("description", "")
            metadata["infoInputDatasets"] = spec.get("inputs", [])
            metadata["dataflowConnections"] = spec.get("outputs", [])
            metadata["programmingLanguage"] = spec.get("language", "")
            metadata["runtimePlatform"] = spec.get("base_container", "")

    elif payload.type == "dataset":
        if "::from::" in payload.path:
            # An external dataset URL pulled from a workflow's notebook
            # (KNMI, PDOK, etc) — re-parse that workflow so this dataset
            # can inherit its geographic/temporal coverage.
            url, _, source_workflow_path = payload.path.partition("::from::")
            with tempfile.TemporaryDirectory() as tmp:
                local_wf_path = download_workflow_with_siblings(owner, repo, ref, source_workflow_path, tmp)
                workflow_data = parse_naavrewf(local_wf_path)
            metadata.update(build_dataset_metadata_from_url(url, workflow_data))
        elif payload.path.startswith("http://") or payload.path.startswith("https://"):
            metadata.update(build_dataset_metadata_from_url(payload.path, {}))
        else:
            metadata.update(build_dataset_metadata_from_repo_path(owner, repo, ref, payload.path))

    return {"metadata": metadata}


@app.post("/publication/publish")
def publish_assets(payload: PublishRequest):
    published = []
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    for asset in payload.assets:
        pid = asset.pid or asset.internalPid or f"urn:uuid:{uuid_lib.uuid4()}"
        repo_url = asset.metadata.get("repositoryUrl")
        workflow_file = asset.metadata.get("workflowFile")

        if asset.type == "workflow" and repo_url and workflow_file:
            owner, repo = parse_github_url(repo_url)
            ref = fetch_default_branch(owner, repo)
            with tempfile.TemporaryDirectory() as tmp:
                local_wf_path = download_workflow_with_siblings(owner, repo, ref, workflow_file, tmp)
                workflow_data = parse_naavrewf(local_wf_path)
                output_dir = f"{PUBLICATION_CRATE_DIR}/{asset.id}_{timestamp}"
                crate_dir = generate_ro_crate(
                    workflow_data=workflow_data,
                    workflow_path=local_wf_path,
                    title=asset.metadata.get("workflowName") or asset.title,
                    description=asset.metadata.get("description", ""),
                    author="",
                    output_dir=output_dir,
                )
            published.append({"id": asset.id, "pid": pid, "crate_path": f"{crate_dir}/ro-crate-metadata.json"})
        else:
            output_dir = f"{PUBLICATION_CRATE_DIR}/{asset.id}_{timestamp}"
            Path(output_dir).mkdir(parents=True, exist_ok=True)
            crate = ROCrate()
            crate.root_dataset["name"] = asset.title
            crate.root_dataset["identifier"] = pid
            crate.root_dataset["additionalType"] = {
                "dataset": "Dataset", "component": "SoftwareApplication"
            }.get(asset.type, "CreativeWork")
            crate.root_dataset["datePublished"] = datetime.now(timezone.utc).isoformat()
            for key, value in asset.metadata.items():
                if value not in (None, "", []):
                    crate.root_dataset[key] = value
            crate.write(output_dir)
            published.append({"id": asset.id, "pid": pid, "crate_path": f"{output_dir}/ro-crate-metadata.json"})

    return {"published": published}
