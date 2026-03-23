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

# =====================================================
# GeoNetwork configuration
# =====================================================
GEONETWORK_BASE_URL = os.getenv(
    "GEONETWORK_BASE_URL",
    "https://lter-life-catalogue.qcdis.org/geonetwork"
)
GEONETWORK_PORTAL = os.getenv("GEONETWORK_PORTAL", "srv")

# =====================================================
# Keycloak configuration
# =====================================================
KEYCLOAK_AUTH_SERVER_URL = os.getenv(
    "KEYCLOAK_AUTH_SERVER_URL",
    "https://lifewatch.lab.uvalight.net/auth"
)
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "vre")
KEYCLOAK_CLIENT_ID = os.getenv(
    "KEYCLOAK_CLIENT_ID",
    "lter-life-catalogue-harvester"
)
KEYCLOAK_CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET")
KEYCLOAK_USERNAME = os.getenv(
    "KEYCLOAK_USERNAME",
    "harvester-service-account"
)
KEYCLOAK_PASSWORD = os.getenv("KEYCLOAK_PASSWORD")

DEFAULT_PAGE_SIZE = 10
MAX_PAGE_SIZE = 100

session = requests.Session()
session.verify = False


class SearchRequest(BaseModel):
    query: str
    page: int = 1
    size: int = DEFAULT_PAGE_SIZE


# =====================================================
# Auth helpers
# =====================================================
def get_keycloak_token() -> str:
    if not KEYCLOAK_CLIENT_SECRET or not KEYCLOAK_PASSWORD:
        raise HTTPException(
            status_code=500,
            detail="Missing KEYCLOAK_CLIENT_SECRET or KEYCLOAK_PASSWORD."
        )

    token_url = (
        f"{KEYCLOAK_AUTH_SERVER_URL.rstrip('/')}"
        f"/realms/{KEYCLOAK_REALM}/protocol/openid-connect/token"
    )

    try:
        resp = requests.post(
            token_url,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={
                "grant_type": "password",
                "client_id": KEYCLOAK_CLIENT_ID,
                "client_secret": KEYCLOAK_CLIENT_SECRET,
                "username": KEYCLOAK_USERNAME,
                "password": KEYCLOAK_PASSWORD,
            },
            timeout=20,
            verify=False,
        )
    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=502,
            detail=f"Keycloak token request failed: {e}"
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=401,
            detail=f"Keycloak token request failed: {resp.text}"
        )

    token = resp.json().get("access_token")
    if not token:
        raise HTTPException(
            status_code=500,
            detail="Keycloak response did not contain an access token."
        )

    return token


def gn_headers(access_token: str) -> dict:
    try:
        session.get(
            f"{GEONETWORK_BASE_URL}/",
            timeout=10,
            allow_redirects=True
        )
    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=502,
            detail=f"Cannot connect to GeoNetwork: {e}"
        )

    xsrf = session.cookies.get("XSRF-TOKEN")

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
    }

    if xsrf:
        headers["X-XSRF-TOKEN"] = xsrf

    return headers


# =====================================================
# Generic helpers
# =====================================================
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


# =====================================================
# Full-record harvesting helpers (XML-based)
# =====================================================

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

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/xml",
    }

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

        text = "".join(el.itertext()).strip()
        text = normalize_text(text)
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

    # ISO19139 style
    iso19139_candidates = [
        ".//gmd:abstract/gco:CharacterString",
        ".//gmd:abstract/gmx:Anchor",
        ".//gmd:identificationInfo//gmd:abstract/gco:CharacterString",
        ".//gmd:identificationInfo//gmd:abstract/gmx:Anchor",
    ]

    for xpath in iso19139_candidates:
        value = get_first_nonempty_text(root.findall(xpath, NAMESPACES))
        if value:
            return truncate_text(value)

    # ISO19115-3 style
    iso19115_3_candidates = [
        ".//mri:abstract/lan:PT_FreeText//lan:LocalisedCharacterString",
        ".//mri:abstract/gco:CharacterString",
        ".//mri:abstract/gcx:Anchor",
    ]

    for xpath in iso19115_3_candidates:
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

    candidates = [
        ".//gmd:title/gco:CharacterString",
        ".//gmd:title/gmx:Anchor",
        ".//cit:title/gco:CharacterString",
        ".//cit:title/gcx:Anchor",
    ]

    for xpath in candidates:
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

    candidates = [
        ".//gmd:organisationName/gco:CharacterString",
        ".//gmd:organisationName/gmx:Anchor",
        ".//cit:party//cit:name/gco:CharacterString",
        ".//cit:party//cit:name/gcx:Anchor",
    ]

    for xpath in candidates:
        value = get_first_nonempty_text(root.findall(xpath, NAMESPACES))
        if value:
            return value

    return ""

def extract_title_from_full_record(record_json: Dict[str, Any]) -> str:
    candidate_paths = [
        ["metadata", "resourceTitleObject", "default"],
        ["resourceTitleObject", "default"],
        ["metadata", "title"],
        ["title"],
    ]

    for path in candidate_paths:
        value = safe_get_nested(record_json, path)
        if value:
            return value

    fallback = find_first_value_by_keys(
        record_json,
        {
            "resourceTitle",
            "resourceTitleObject",
            "title",
            "name"
        }
    )
    if fallback:
        return fallback

    return "Untitled record"


def extract_org_from_full_record(record_json: Dict[str, Any]) -> str:
    candidate_paths = [
        ["metadata", "orgNameObject", "default"],
        ["orgNameObject", "default"],
        ["metadata", "organisation"],
        ["organisation"],
        ["owner"],
    ]

    for path in candidate_paths:
        value = safe_get_nested(record_json, path)
        if value:
            return value

    fallback = find_first_value_by_keys(
        record_json,
        {
            "orgName",
            "orgNameObject",
            "organisation",
            "organisationName",
            "owner",
            "publisher"
        }
    )
    if fallback:
        return fallback

    return ""


def enrich_hit_with_full_record(
    hit: Dict[str, Any],
    headers: Dict[str, str],
    access_token: str
) -> Dict[str, Any]:
    source = hit.get("_source", {}) or {}
    uuid = normalize_text(source.get("uuid"))

    # lightweight fields from search result
    title = (
        normalize_text(source.get("title")) or
        safe_get_nested(source, ["resourceTitleObject", "default"]) or
        "Untitled record"
    )

    description = (
        normalize_text(source.get("description")) or
        safe_get_nested(source, ["resourceAbstractObject", "default"]) or
        normalize_text(source.get("abstract"))
    )

    organisation = (
        normalize_text(source.get("organisation")) or
        safe_get_nested(source, ["orgNameObject", "default"]) or
        normalize_text(source.get("owner"))
    )

    # only fetch XML if something important is missing
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


def enrich_hits_with_full_records(
    hits: List[Dict[str, Any]],
    headers: Dict[str, str],
    access_token: str
) -> List[Dict[str, Any]]:
    enriched_hits = []
    for hit in hits:
        enriched_hits.append(enrich_hit_with_full_record(hit, headers, access_token))
    return enriched_hits

# =====================================================
# API
# =====================================================
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
        return {
            "page": page,
            "size": size,
            "total": 0,
            "total_pages": 0,
            "has_previous": False,
            "has_next": False,
            "hits": {
                "total": 0,
                "hits": []
            }
        }

    access_token = get_keycloak_token()
    headers = gn_headers(access_token)

    search_url = f"{GEONETWORK_BASE_URL}/{GEONETWORK_PORTAL}/api/search/records/_search"

    body = {
        "from": offset,
        "size": size,
        "_source": {
            "includes": [
                "uuid",
                "id",
                "resourceTitleObject.default",
                "resourceAbstractObject.default",
                "orgNameObject.default",
                "title",
                "abstract",
                "description",
                "organisation",
                "owner"
            ]
        },
        "query": {
            "bool": {
                "must": [
                    {
                        "query_string": {
                            "query": query
                        }
                    }
                ],
                "filter": [
                    {"term": {"isTemplate": {"value": "n"}}}
                ]
            }
        }
    }

    try:
        resp = session.post(
            search_url,
            headers=headers,
            json=body,
            timeout=30
        )
    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=502,
            detail=f"GeoNetwork search request failed: {e}"
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=500,
            detail=f"GeoNetwork search failed: {resp.status_code} {resp.text}"
        )

    data = resp.json()
    total = extract_total_hits(data)
    total_pages = math.ceil(total / size) if total > 0 else 0

    raw_hits = data.get("hits", {}).get("hits", [])
    enriched_hits = enrich_hits_with_full_records(raw_hits, headers, access_token)
    return {
        "page": page,
        "size": size,
        "total": total,
        "total_pages": total_pages,
        "has_previous": page > 1,
        "has_next": page < total_pages,
        "hits": {
            "total": data.get("hits", {}).get("total", total),
            "hits": enriched_hits
        }
    }