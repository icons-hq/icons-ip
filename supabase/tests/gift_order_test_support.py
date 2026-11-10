"""Identity checks shared by the gift suites that commit disposable fixtures."""
from __future__ import annotations

import json
import os
import re
import subprocess
import uuid


def checked_scope(environment: dict[str, str] | None = None) -> str:
    environment = os.environ if environment is None else environment
    scope = environment.get("GIFT_ORDER_TEST_SCOPE")
    if scope not in ("ci", "isolated-local"):
        raise ValueError("Set GIFT_ORDER_TEST_SCOPE=ci or isolated-local")
    if scope == "ci" and (environment.get("CI") != "true" or environment.get("GITHUB_ACTIONS") != "true"):
        raise ValueError("CI scope requires the GitHub Actions environment")
    return scope


def inspect_source(name: str, scope: str) -> dict:
    if not re.fullmatch(r"supabase_db_(?:icons-ip(?:-[a-z0-9]+)*|icons-admin-release-[a-f0-9]{8})", name):
        raise ValueError("Select an exact local ICONS IP Supabase container name")
    project = name.removeprefix("supabase_db_")
    if scope == "ci" and project != "icons-ip":
        raise ValueError("CI scope requires the icons-ip project")
    result = subprocess.run(["docker", "inspect", "--format", "{{json .}}", name],
                            text=True, capture_output=True, check=True, timeout=20)
    value = json.loads(result.stdout)
    if (not re.fullmatch(r"[0-9a-f]{64}", value.get("Id", "")) or value.get("Name") != "/" + name
            or value.get("State", {}).get("Running") is not True
            or value.get("Config", {}).get("Labels", {}).get("com.supabase.cli.project") != project):
        raise ValueError("Docker Supabase identity or running state changed")
    return {"id": value["Id"], "name": name, "project": project}


def validate_owned_clone(container: str, database: str, environment: dict[str, str] | None = None) -> dict:
    environment = os.environ if environment is None else environment
    scope = checked_scope(environment)
    lease = environment.get("GIFT_ORDER_CLONE_LEASE", "")
    if not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", lease):
        raise ValueError("An explicit owned-clone lease is required")
    if database != "icons_gift_orders_" + uuid.UUID(lease).hex:
        raise ValueError("Only the exact leased gift clone may receive committed fixtures")
    if not re.fullmatch(r"[0-9a-f]{64}", container):
        raise ValueError("Use the immutable full Docker container ID")
    identity = inspect_source(environment.get("GIFT_ORDER_SOURCE_CONTAINER", ""), scope)
    if identity["id"] != container:
        raise ValueError("Clone container identity changed")
    proof = subprocess.run(["docker", "exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres",
                            "-d", database, "-v", "ON_ERROR_STOP=1", "-v", f"lease={lease}",
                            "-v", f"container_id={container}", "-v", f"database={database}"],
                           input="begin read only; select current_database()=:'database' and current_database()<>'postgres' "
                           "and exists(select 1 from private.operator_fixture_clone_identity where singleton "
                           "and lease=:'lease'::uuid and container_id=:'container_id' and source_database='postgres' "
                           "and created_at>clock_timestamp()-interval '2 hours'); rollback;",
                           text=True, capture_output=True, timeout=20)
    if proof.returncode != 0 or proof.stdout.strip() != "t":
        raise ValueError("Owned clone identity/lease is absent, stale, or mismatched")
    return identity
