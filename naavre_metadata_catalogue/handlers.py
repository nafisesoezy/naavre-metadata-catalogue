import json
import os
import requests

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from tornado import web

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
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "lter-life-catalogue-harvester")
KEYCLOAK_CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET")
KEYCLOAK_USERNAME = os.getenv("KEYCLOAK_USERNAME", "harvester-service-account")
KEYCLOAK_PASSWORD = os.getenv("KEYCLOAK_PASSWORD")

session = requests.Session()
session.verify = False


def get_keycloak_token() -> str:
    if not KEYCLOAK_CLIENT_SECRET or not KEYCLOAK_PASSWORD:
        raise web.HTTPError(
            500,
            "Missing KEYCLOAK_CLIENT_SECRET or KEYCLOAK_PASSWORD environment variable."
        )

    token_url = (
        f"{KEYCLOAK_AUTH_SERVER_URL.rstrip('/')}"
        f"/realms/{KEYCLOAK_REALM}/protocol/openid-connect/token"
    )

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

    if resp.status_code != 200:
        raise web.HTTPError(401, f"Keycloak token request failed: {resp.text}")

    return resp.json()["access_token"]


def gn_headers(access_token: str) -> dict:
    session.get(f"{GEONETWORK_BASE_URL}/", timeout=10, allow_redirects=True)
    xsrf = session.cookies.get("XSRF-TOKEN")

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
    }
    if xsrf:
        headers["X-XSRF-TOKEN"] = xsrf

    return headers


class CatalogueSearchHandler(APIHandler):
    @web.authenticated
    def get(self):
        query = self.get_argument("q", "").strip()

        if not query:
            self.set_header("Content-Type", "application/json")
            self.finish(json.dumps({"results": []}))
            return

        access_token = get_keycloak_token()
        search_url = f"{GEONETWORK_BASE_URL}/{GEONETWORK_PORTAL}/api/search/records/_search"
        headers = gn_headers(access_token)

        body = {
            "from": 0,
            "size": 10,
            "_source": {
                "includes": [
                    "uuid",
                    "id",
                    "resourceTitleObject.default",
                    "resourceAbstractObject.default"
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

        resp = session.post(search_url, headers=headers, json=body, timeout=30)

        if resp.status_code != 200:
            raise web.HTTPError(
                500,
                f"GeoNetwork search failed: {resp.status_code} {resp.text}"
            )

        data = resp.json()
        hits = (data.get("hits") or {}).get("hits") or []

        results = []
        for hit in hits:
            src = hit.get("_source", {})

            title = (
                (src.get("resourceTitleObject") or {}).get("default")
                or "Untitled record"
            )
            abstract = (
                (src.get("resourceAbstractObject") or {}).get("default")
                or ""
            )

            results.append({
                "uuid": src.get("uuid"),
                "id": src.get("id"),
                "title": title,
                "abstract": abstract,
            })

        self.set_header("Content-Type", "application/json")
        self.finish(json.dumps({"results": results}))


def setup_handlers(web_app):
    base_url = web_app.settings["base_url"]
    host_pattern = ".*$"

    handlers = [
        (
            url_path_join(base_url, "lterlife-catalogue", "search"),
            CatalogueSearchHandler,
        )
    ]

    web_app.add_handlers(host_pattern, handlers)