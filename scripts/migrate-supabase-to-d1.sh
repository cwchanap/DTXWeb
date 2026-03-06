#!/usr/bin/env bash
# =============================================================================
# Supabase PostgreSQL → Cloudflare D1 Data Migration Script
# =============================================================================
#
# Exports data from Supabase PostgreSQL and imports it into Cloudflare D1.
#
# Prerequisites:
#   - psql (PostgreSQL client) installed
#   - wrangler CLI installed and authenticated
#   - D1 database already created with schema applied
#   - SUPABASE_DB_URL env var set (or pass as argument)
#
# Usage:
#   # Local D1 (development):
#   ./scripts/migrate-supabase-to-d1.sh --local
#
#   # Remote D1 (production):
#   ./scripts/migrate-supabase-to-d1.sh --remote
#
#   # With explicit Supabase connection string:
#   SUPABASE_DB_URL="postgresql://..." ./scripts/migrate-supabase-to-d1.sh --remote
#
#   # Dry-run (export only, no import):
#   ./scripts/migrate-supabase-to-d1.sh --dry-run
# =============================================================================

set -euo pipefail

# Configuration
D1_DB_NAME="${D1_DB_NAME:-dtx-web}"
WRANGLER_DIR="packages/dtx-web"
OUTPUT_DIR="$(mktemp -d)"

cleanup() {
  # Skip cleanup in dry-run mode to preserve SQL for manual review
  if [ "$DRY_RUN" = false ]; then
    rm -rf "$OUTPUT_DIR"
  fi
}
trap cleanup EXIT

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# Parse arguments
MODE="local"
DRY_RUN=false
for arg in "$@"; do
  case $arg in
    --local) MODE="local" ;;
    --remote) MODE="remote" ;;
    --dry-run) DRY_RUN=true ;;
    --db=*) D1_DB_NAME="${arg#*=}" ;;
    *) err "Unknown argument: $arg"; exit 1 ;;
  esac
done

# Check prerequisites
if ! command -v psql &> /dev/null; then
  err "psql is not installed. Install with: brew install libpq"
  exit 1
fi

if ! command -v wrangler &> /dev/null && [ "$DRY_RUN" = false ]; then
  err "wrangler is not installed. Install with: npm install -g wrangler"
  exit 1
fi

if ! command -v python3 &> /dev/null; then
  err "python3 is not installed. Install Python 3 to run CSV-safe migration processing."
  exit 1
fi

# Get Supabase connection string
if [ -z "${SUPABASE_DB_URL:-}" ]; then
  # Try to construct from .env file
  SUPABASE_URL=""
  PROJECT_ID=""
  if [ -f "packages/dtx-web/.env" ]; then
    if grep -q -E '^PUBLIC_SUPABASE_URL=' packages/dtx-web/.env; then
      SUPABASE_URL=$(grep -E '^PUBLIC_SUPABASE_URL=' packages/dtx-web/.env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
      PROJECT_ID=$(printf '%s' "$SUPABASE_URL" | sed -En 's|https://([^.]+)\.supabase\.co.*|\1|p')
    fi

    if [ -n "$PROJECT_ID" ]; then
      warn "Supabase project ID detected: $PROJECT_ID"
      warn "Set SUPABASE_DB_URL to your Supabase database connection string."
      warn "Find it at: https://supabase.com/dashboard/project/$PROJECT_ID/settings/database"
      echo ""
      echo "  export SUPABASE_DB_URL='postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres'"
      echo ""
      exit 1
    fi
  fi
  err "SUPABASE_DB_URL environment variable is not set."
  exit 1
fi

log "Starting Supabase → D1 data migration"
log "D1 database: $D1_DB_NAME"
log "Mode: $MODE"
log "Temp directory: $OUTPUT_DIR"
echo ""

# ---- Step 1: Export data from Supabase ----

log "Step 1: Exporting data from Supabase PostgreSQL..."

# Export simfiles
psql "$SUPABASE_DB_URL" -c "
  COPY (
    SELECT id, title, artist, bpm, user_id,
           CASE WHEN is_published THEN 1 ELSE 0 END as is_published,
           display_id, download_url, preview_url, video_preview_url,
           to_char(publish_date, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') as publish_date,
           to_char(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') as created_at,
           to_char(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') as updated_at
    FROM public.simfiles
    ORDER BY id
  ) TO STDOUT WITH (FORMAT CSV, HEADER, NULL '\\N');
" > "$OUTPUT_DIR/simfiles.csv"

SIMFILE_COUNT=$(( $(wc -l < "$OUTPUT_DIR/simfiles.csv" | tr -d ' ') - 1 ))
if [ "$SIMFILE_COUNT" -lt 0 ]; then SIMFILE_COUNT=0; fi
log "  Exported $SIMFILE_COUNT simfiles"

# Export dtx_files
psql "$SUPABASE_DB_URL" -c "
  COPY (
    SELECT id, label, level, simfile_id
    FROM public.dtx_files
    ORDER BY id
  ) TO STDOUT WITH (FORMAT CSV, HEADER, NULL '\\N');
" > "$OUTPUT_DIR/dtx_files.csv"

DTX_COUNT=$(( $(wc -l < "$OUTPUT_DIR/dtx_files.csv" | tr -d ' ') - 1 ))
if [ "$DTX_COUNT" -lt 0 ]; then DTX_COUNT=0; fi
log "  Exported $DTX_COUNT dtx_files"

# Export user_profiles
psql "$SUPABASE_DB_URL" -c "
  COPY (
    SELECT id, user_id, username
    FROM public.user_profiles
    ORDER BY id
  ) TO STDOUT WITH (FORMAT CSV, HEADER, NULL '\\N');
" > "$OUTPUT_DIR/user_profiles.csv"

PROFILE_COUNT=$(( $(wc -l < "$OUTPUT_DIR/user_profiles.csv" | tr -d ' ') - 1 ))
if [ "$PROFILE_COUNT" -lt 0 ]; then PROFILE_COUNT=0; fi
log "  Exported $PROFILE_COUNT user_profiles"

echo ""

# ---- Step 2: Generate D1-compatible SQL ----

log "Step 2: Generating D1-compatible SQL..."

SQL_FILE="$OUTPUT_DIR/d1-import.sql"

cat > "$SQL_FILE" << 'HEADER'
-- Auto-generated data migration: Supabase PostgreSQL → Cloudflare D1
-- Generated at: TIMESTAMP_PLACEHOLDER
PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

HEADER

# Replace timestamp
sed -i.bak "s/TIMESTAMP_PLACEHOLDER/$(date -u +%Y-%m-%dT%H:%M:%SZ)/" "$SQL_FILE"

# Generate INSERT statements using CSV-safe parsing
log "  Generating INSERT statements from CSV exports..."
python3 - "$OUTPUT_DIR/simfiles.csv" "$OUTPUT_DIR/dtx_files.csv" "$OUTPUT_DIR/user_profiles.csv" "$SQL_FILE" <<'PY'
import csv
import sys
from typing import Optional

simfiles_csv, dtx_files_csv, user_profiles_csv, sql_file = sys.argv[1:5]


def is_null(value: Optional[str]) -> bool:
    return value is None or value == "\\N"


def sql_text(value: Optional[str], *, nullable: bool = False) -> str:
    if is_null(value):
        return "NULL" if nullable else "''"
    return "'" + value.replace("'", "''") + "'"


def sql_number(value: Optional[str], *, nullable: bool = False) -> str:
    if is_null(value):
        return "NULL" if nullable else "0"
    return value


with open(sql_file, "a", encoding="utf-8", newline="") as out:
    with open(simfiles_csv, "r", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            out.write(
                "INSERT INTO simfiles (id, title, artist, bpm, user_id, is_published, display_id, download_url, preview_url, video_preview_url, publish_date, created_at, updated_at) "
                "VALUES ({id}, {title}, {artist}, {bpm}, {user_id}, {is_published}, {display_id}, {download_url}, {preview_url}, {video_preview_url}, {publish_date}, {created_at}, {updated_at});\n".format(
                    id=sql_number(row.get("id")),
                    title=sql_text(row.get("title")),
                    artist=sql_text(row.get("artist")),
                    bpm=sql_number(row.get("bpm")),
                    user_id=sql_text(row.get("user_id")),
                    is_published=sql_number(row.get("is_published")),
                    display_id=sql_number(row.get("display_id"), nullable=True),
                    download_url=sql_text(row.get("download_url"), nullable=True),
                    preview_url=sql_text(row.get("preview_url"), nullable=True),
                    video_preview_url=sql_text(row.get("video_preview_url"), nullable=True),
                    publish_date=sql_text(row.get("publish_date")),
                    created_at=sql_text(row.get("created_at")),
                    updated_at=sql_text(row.get("updated_at")),
                )
            )

    with open(dtx_files_csv, "r", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            out.write(
                "INSERT INTO dtx_files (id, label, level, simfile_id) VALUES ({id}, {label}, {level}, {simfile_id});\n".format(
                    id=sql_number(row.get("id")),
                    label=sql_text(row.get("label")),
                    level=sql_number(row.get("level")),
                    simfile_id=sql_number(row.get("simfile_id")),
                )
            )

    with open(user_profiles_csv, "r", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            out.write(
                "INSERT INTO user_profiles (id, user_id, username) VALUES ({id}, {user_id}, {username});\n".format(
                    id=sql_number(row.get("id")),
                    user_id=sql_text(row.get("user_id")),
                    username=sql_text(row.get("username")),
                )
            )
PY

echo "" >> "$SQL_FILE"
echo "COMMIT;" >> "$SQL_FILE"

TOTAL_STMTS=$(grep -c "^INSERT" "$SQL_FILE" || true)
log "  Generated $TOTAL_STMTS INSERT statements"
echo ""

# ---- Step 3: Import into D1 ----

if [ "$DRY_RUN" = true ]; then
  log "Dry-run mode: SQL file saved to $SQL_FILE"
  log "Review the file, then run:"
  echo ""
  echo "  cd $WRANGLER_DIR && npx wrangler d1 execute $D1_DB_NAME --file=$SQL_FILE --$MODE"
  echo ""
  log "Note: Temporary directory $OUTPUT_DIR is preserved for manual review"
  exit 0
fi

log "Step 3: Importing data into D1 ($MODE)..."

cd "$WRANGLER_DIR"
npx wrangler d1 execute "$D1_DB_NAME" --file="$SQL_FILE" --"$MODE"

echo ""

# ---- Step 4: Verify counts ----

log "Step 4: Verifying record counts..."

VERIFY_SIMFILES=$(npx wrangler d1 execute "$D1_DB_NAME" --command="SELECT COUNT(*) FROM simfiles;" --"$MODE" --json 2>/dev/null | grep -o '"COUNT(\*)":[ ]*[0-9]*' | grep -o '[0-9]*' || echo "?")
VERIFY_DTX=$(npx wrangler d1 execute "$D1_DB_NAME" --command="SELECT COUNT(*) FROM dtx_files;" --"$MODE" --json 2>/dev/null | grep -o '"COUNT(\*)":[ ]*[0-9]*' | grep -o '[0-9]*' || echo "?")
VERIFY_PROFILES=$(npx wrangler d1 execute "$D1_DB_NAME" --command="SELECT COUNT(*) FROM user_profiles;" --"$MODE" --json 2>/dev/null | grep -o '"COUNT(\*)":[ ]*[0-9]*' | grep -o '[0-9]*' || echo "?")

echo ""
log "Verification results:"
echo "  simfiles:      exported=$SIMFILE_COUNT  imported=$VERIFY_SIMFILES"
echo "  dtx_files:     exported=$DTX_COUNT  imported=$VERIFY_DTX"
echo "  user_profiles: exported=$PROFILE_COUNT  imported=$VERIFY_PROFILES"
echo ""

if [ "$VERIFY_SIMFILES" = "$SIMFILE_COUNT" ] && [ "$VERIFY_DTX" = "$DTX_COUNT" ] && [ "$VERIFY_PROFILES" = "$PROFILE_COUNT" ]; then
  log "✅ Migration completed successfully! All counts match."
else
  warn "⚠️  Count mismatch detected. Please verify the data manually."
fi

log "Temporary files cleaned up."
