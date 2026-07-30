#!/usr/bin/env bash
# =============================================================================
# Aplica migrations e seed no banco apontado por DATABASE_URL.
#
#   ./scripts/db.sh migrate   -> aplica supabase/migrations/*.sql em ordem
#   ./scripts/db.sh seed      -> aplica supabase/seed.sql (demonstrativo)
#   ./scripts/db.sh reset     -> migrate + seed
#
# DATABASE_URL vem do painel do Supabase (Settings > Database > Connection
# string). Este script é ADMINISTRATIVO e roda fora do runtime da aplicação —
# é o único contexto em que credenciais privilegiadas são aceitáveis.
# =============================================================================
set -euo pipefail

if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  set -a; source .env.local; set +a
fi

: "${DATABASE_URL:?Defina DATABASE_URL (veja .env.example)}"

migrate() {
  for file in supabase/migrations/*.sql; do
    echo "→ $(basename "$file")"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$file"
  done
  echo "✓ migrations aplicadas"
}

seed() {
  echo "→ seed demonstrativo"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
  echo "✓ seed aplicado"
}

case "${1:-}" in
  migrate) migrate ;;
  seed)    seed ;;
  reset)   migrate; seed ;;
  *) echo "uso: $0 {migrate|seed|reset}" >&2; exit 1 ;;
esac
