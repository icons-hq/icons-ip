#!/usr/bin/env bash
set -euo pipefail
# All migrations must already be applied. This command clones the source and
# never installs a draft or commits fixtures to the source database.
test_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$test_root"
exec python3 supabase/tests/gift_orders_isolated.py "$@"
