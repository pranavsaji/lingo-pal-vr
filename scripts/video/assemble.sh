#!/bin/sh
# Turn a recorded clip (.tmp/video/<name>: f-<ms>.jpg + audio.webm) into a 1080p 30 fps MP4,
# holding each screencast frame until the next one (variable frame rate in, constant out).
set -e
dir=".tmp/video/$1"
out="${2:-.tmp/video/$1.mp4}"
cd "$dir"
ls f-*.jpg | sort > frames.txt
python3 -I - <<'PY'
import os
names = [l.strip() for l in open('frames.txt') if l.strip()]
with open('concat.txt', 'w') as f:
    for i, n in enumerate(names):
        t = int(n[2:-4]); nxt = int(names[i + 1][2:-4]) if i + 1 < len(names) else t + 33
        f.write(f"file '{n}'\nduration {max(nxt - t, 1) / 1000:.3f}\n")
    f.write(f"file '{names[-1]}'\n")
PY
cd - >/dev/null
if [ -f "$dir/audio.webm" ]; then A="-i $dir/audio.webm -c:a aac -b:a 192k -shortest"; else A=""; fi
ffmpeg -v error -y -f concat -safe 0 -i "$dir/concat.txt" $A \
  -vf "scale=1920:-2:flags=lanczos,crop=1920:1080:0:46,fps=30,format=yuv420p" -c:v libx264 -crf 17 -preset slow "$out"
echo "$out"
