#!/bin/sh
# Make a seamless mono loop: take L+X seconds from START, cross-fade the last X into the first X,
# so the loop's end runs straight back into its start. Whole seconds only.
# Usage: scripts/make-loop.sh in.mp3 out.mp3 START L X
in=$1; out=$2; s=$3; L=$4; X=$5
ffmpeg -v error -y -i "$in" -filter_complex "[0:a]atrim=start=$s:end=$((s+L+X)),asetpts=PTS-STARTPTS,pan=mono|c0=0.5*c0+0.5*c1,asplit[a][b];[a]atrim=start=$L:end=$((L+X)),asetpts=PTS-STARTPTS[tail];[b]atrim=start=0:end=$L,asetpts=PTS-STARTPTS[body];[tail][body]acrossfade=d=$X:c1=qsin:c2=qsin,loudnorm=I=-23:TP=-2[o]" -map "[o]" -ar 44100 -b:a 64k "$out"
