#!/usr/bin/env bash
# Assemble frames/{A..D}-*.jpg and frames/{A..D}.wav into the showcase MP4.
set -euo pipefail
cd "$(dirname "$0")/out"
parts=$(ls frames/*.wav | xargs -n1 basename | sed 's/.wav//' | sort | tr '\n' ' ')
echo "parts: $parts"
: > audio-list.txt
for p in $parts; do echo "file 'frames/$p.wav'" >> audio-list.txt; done
ffmpeg -y -loglevel error -f concat -safe 0 -i audio-list.txt -c copy showcase-audio.wav
frames=$(ls frames/*.jpg | wc -l)
dur=$(python3 -c "print($frames/30)")
fade_start=$(python3 -c "print(max(0, $frames/30 - 1.2))")
echo "frames: $frames  video: ${dur}s  audio: $(ffprobe -v error -show_entries format=duration -of csv=p=0 showcase-audio.wav)s"
ffmpeg -y -loglevel error -framerate 30 -pattern_type glob -i 'frames/*.jpg' -i showcase-audio.wav \
  -filter_complex "[0:v]fade=t=out:st=${fade_start}:d=1.2[v];[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st=${fade_start}:d=1.2,aresample=48000[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -profile:v high -preset slow -crf 18 -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 192k -movflags +faststart -t "$dur" clay-island-showcase.mp4
ffprobe -v error -show_entries stream=codec_name,width,height,sample_rate -show_entries format=duration,size -of default=nw=1 clay-island-showcase.mp4
