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
D1_DB_NAME="${D1_DB_NAME:-drumery-db}"
WRANGLER_DIR="packages/dtx-web"
OUTPUT_DIR="$(mktemp -d)"

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

# Get Supabase connection string
if [ -z "${SUPABASE_DB_URL:-}" ]; then
  # Try to construct from .env file
  if [ -f "packages/dtx-web/.env" ]; then
    # Extract project ID from SUPABASE_URL
    SUPABASE_URL=$(grep -E '^PUBLIC_SUPABASE_URL=' packages/dtx-web/.env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    PROJECT_ID=$(echo "$SUPABASE_URL" | sed -E 's|https://([^.]+)\.supabase\.co.*|\1|')

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
psql "$SUPABASE_DB_URL" -t -A -F'|' -c "
  SELECT id, title, artist, bpm, user_id,
         CASE WHEN is_published THEN 1 ELSE 0 END as is_published,
         display_id, download_url, preview_url, video_preview_url,
         to_char(publish_date, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') as publish_date,
         to_char(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') as created_at,
         to_char(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') as updated_at
  FROM public.simfiles
  ORDER BY id;
" > "$OUTPUT_DIR/simfiles.csv"

SIMFILE_COUNT=$(wc -l < "$OUTPUT_DIR/simfiles.csv" | tr -d ' ')
log "  Exported $SIMFILE_COUNT simfiles"

# Export dtx_files
psql "$SUPABASE_DB_URL" -t -A -F'|' -c "
  SELECT id, label, level, simfile_id
  FROM public.dtx_files
  ORDER BY id;
" > "$OUTPUT_DIR/dtx_files.csv"

DTX_COUNT=$(wc -l < "$OUTPUT_DIR/dtx_files.csv" | tr -d ' ')
log "  Exported $DTX_COUNT dtx_files"

# Export user_profiles
psql "$SUPABASE_DB_URL" -t -A -F'|' -c "
  SELECT id, user_id, username
  FROM public.user_profiles
  ORDER BY id;
" > "$OUTPUT_DIR/user_profiles.csv"

PROFILE_COUNT=$(wc -l < "$OUTPUT_DIR/user_profiles.csv" | tr -d ' ')
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

# Helper: escape single quotes for SQLite
escape_sql() {
  echo "$1" | sed "s/'/''/g"
}

# Generate INSERT statements for simfiles
log "  Generating simfiles INSERT statements..."
while IFS='|' read -r id title artist bpm user_id is_published display_id download_url preview_url video_preview_url publish_date created_at updated_at; do
  [ -z "$id" ] && continue

  # Handle NULL values
  display_id_val="${display_id:+$display_id}"
  [ -z "$display_id_val" ] && display_id_val="NULL" || display_id_val="$display_id_val"

  download_url_val="${download_url}"
  [ -z "$download_url_val" ] && download_url_val="NULL" || download_url_val="'$(escape_sql "$download_url_val")'"

  preview_url_val="${preview_url}"
  [ -z "$preview_url_val" ] && preview_url_val="NULL" || preview_url_val="'$(escape_sql "$preview_url_val")'"

  video_preview_url_val="${video_preview_url}"
  [ -z "$video_preview_url_val" ] && video_preview_url_val="NULL" || video_preview_url_val="'$(escape_sql "$video_preview_url_val")'"

  echo "INSERT INTO simfiles (id, title, artist, bpm, user_id, is_published, display_id, download_url, preview_url, video_preview_url, publish_date, created_at, updated_at) VALUES ($id, '$(escape_sql "$title")', '$(escape_sql "$artist")', $bpm, '$(escape_sql "$user_id")', $is_published, $display_id_val, $download_url_val, $preview_url_val, $video_preview_url_val, '$publish_date', '$created_at', '$updated_at');" >> "$SQL_FILE"
done < "$OUTPUT_DIR/simfiles.csv"

# Generate INSERT statements for dtx_files
log "  Generating dtx_files INSERT statements..."
while IFS='|' read -r id label level simfile_id; do
  [ -z "$id" ] && continue
  echo "INSERT INTO dtx_files (id, label, level, simfile_id) VALUES ($id, '$(escape_sql "$label")', $level, $simfile_id);" >> "$SQL_FILE"
done < "$OUTPUT_DIR/dtx_files.csv"

# Generate INSERT statements for user_profiles
log "  Generating user_profiles INSERT statements..."
while IFS='|' read -r id user_id username; do
  [ -z "$id" ] && continue
  echo "INSERT INTO user_profiles (id, user_id, username) VALUES ($id, '$(escape_sql "$user_id")', '$(escape_sql "$username")');" >> "$SQL_FILE"
done < "$OUTPUT_DIR/user_profiles.csv"

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

# Cleanup
rm -rf "$OUTPUT_DIR"
log "Temporary files cleaned up."
