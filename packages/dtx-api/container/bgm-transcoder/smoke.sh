#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temporary_directory="$(mktemp -d)"
server_pid=""

cleanup() {
	if [[ -n "$server_pid" ]]; then
		kill "$server_pid" 2>/dev/null || true
		wait "$server_pid" 2>/dev/null || true
	fi
	rm -rf "$temporary_directory"
}
trap cleanup EXIT

ffmpeg \
	-nostdin \
	-hide_banner \
	-loglevel error \
	-y \
	-f lavfi \
	-i 'sine=frequency=440:duration=0.4' \
	-c:a libvorbis \
	"$temporary_directory/source.ogg"

ffmpeg \
	-nostdin \
	-hide_banner \
	-loglevel error \
	-y \
	-f lavfi \
	-i 'sine=frequency=880:duration=0.4' \
	-c:a pcm_s16le \
	"$temporary_directory/source.wav"

bun "$script_dir/server.ts" &
server_pid="$!"

server_ready=false
for _ in {1..50}; do
	if ! kill -0 "$server_pid" 2>/dev/null; then
		echo 'Transcoder server exited before becoming ready' >&2
		exit 1
	fi

	status="$(
		curl \
			--silent \
			--output /dev/null \
			--write-out '%{http_code}' \
			"http://127.0.0.1:8080/transcode/to-m4a" ||
			true
	)"
	if [[ "$status" == "405" ]]; then
		server_ready=true
		break
	fi
	sleep 0.1
done

if [[ "$server_ready" != "true" ]]; then
	echo 'Timed out waiting for transcoder server' >&2
	exit 1
fi

verify_transcode() {
	local source_name="$1"
	local source_path="$2"
	local output_path="$temporary_directory/${source_name}.m4a"
	local http_status
	local codec

	http_status="$(
		curl \
			--silent \
			--show-error \
			--output "$output_path" \
			--write-out '%{http_code}' \
			--header 'Content-Type: application/octet-stream' \
			--data-binary "@$source_path" \
			'http://127.0.0.1:8080/transcode/to-m4a'
	)"
	if [[ "$http_status" != "200" ]]; then
		echo "$source_name transcode returned HTTP $http_status" >&2
		return 1
	fi

	codec="$(
		ffprobe \
			-v error \
			-select_streams a:0 \
			-show_entries stream=codec_name \
			-of default=noprint_wrappers=1:nokey=1 \
			"$output_path"
	)"
	if [[ "$codec" != "aac" ]]; then
		echo "$source_name transcode returned codec '${codec:-none}'" >&2
		return 1
	fi

	echo "$source_name -> AAC"
}

verify_transcode 'vorbis-ogg' "$temporary_directory/source.ogg"
verify_transcode 'pcm-wav' "$temporary_directory/source.wav"
