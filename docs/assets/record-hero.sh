#!/usr/bin/env bash
# Record the README hero: a throwaway browser driven by agent-hands, with the
# command shown as a caption. Captured over CDP (docs/assets/screencast.mjs),
# so nothing outside that page can end up in the file. Run from the repo:
#   bash docs/assets/record-hero.sh <cdp-port>
# Produces docs/assets/hero.mp4 and docs/assets/hero.gif.
set -u
export MSYS_NO_PATHCONV=1
port="${1:?cdp port}"
cd "$(dirname "$0")/../.."
H="node bin/agent-hands.mjs"
SC="node docs/assets/screencast.mjs"
A=docs/assets
F="$A/hero-frames"
DUR=24

# 1. Park the page and size the window.
$SC size "$port" 1280 800
$H open "https://www.npmjs.com/" --here --cdp "$port" >/dev/null 2>&1
sleep 3

# 2. Start the page screencast, then drive. Every step logs its epoch ms.
rm -rf "$F" "$A/hero.log"
$SC record "$port" "$F" $DUR &
REC=$!
sleep 1.5
step() { local label="$1"; shift; printf '%s\t%s\n' "$(date +%s%3N)" "$label" >> "$A/hero.log"; "$@" >/dev/null 2>&1; }

step 'agent-hands snapshot                      # see the page, get @e refs'   $H snapshot --cdp "$port"
step 'agent-hands fill "input[name=q]" "agent-hands"   # 62ms dwell, 109ms flight'   $H fill "input[name=q]" "agent-hands" --cdp "$port"
step 'agent-hands click --text "Search"          # Bezier path, overshoot, 72ms press'   $H click --text "Search" --cdp "$port"
step 'agent-hands wait --text "Human-rate mouse"'                              $H wait --text "Human-rate mouse" --timeout 10 --cdp "$port"
step 'agent-hands press Escape                  # close the suggestion list'    $H press Escape --cdp "$port"
step 'agent-hands click --text "agent-hands"    # the exact match'     $H click --text "agent-hands" --cdp "$port"
step 'agent-hands wait --settled'                                              $H wait --settled --timeout 8 --cdp "$port"
step 'agent-hands text h1                       # -> agent-hands'            $H text h1 --cdp "$port"
step 'The physical cursor never moved. The window was never raised.'           sleep 3
wait $REC
printf '%s\tend\n' "$(date +%s%3N)" >> "$A/hero.log"

# 3. Frames -> video, captions burned in, then the GIF.
ffmpeg -y -loglevel error -f concat -safe 0 -i "$F/frames.txt" -vf "fps=12,scale=1280:-2" -c:v libx264 -pix_fmt yuv420p -preset veryfast "$A/hero-raw.mp4"
FONT="'C\\:/Windows/Fonts/consola.ttf'"
filter=$(node -e '
  const fs = require("fs");
  const start = Number(fs.readFileSync(process.argv[3], "utf8"));
  const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map(l => l.split("\t")).map(([t, s]) => [Math.max(0, (Number(t) - start) / 1000), s]);
  const esc = s => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/\x27/g, "’").replace(/%/g, "\\%");
  const parts = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const [t, s] = rows[i]; const end = rows[i + 1][0];
    parts.push(`drawtext=fontfile=${process.argv[2]}:text=\x27${esc("$ " + s)}\x27:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.78:boxborderw=14:x=24:y=h-72:enable=\x27between(t,${t.toFixed(2)},${end.toFixed(2)})\x27`);
  }
  process.stdout.write(parts.join(","));
' "$A/hero.log" "$FONT" "$F/start.txt")
ffmpeg -y -loglevel error -i "$A/hero-raw.mp4" -vf "$filter" -c:v libx264 -pix_fmt yuv420p -preset veryfast "$A/hero.mp4"
ffmpeg -y -loglevel error -i "$A/hero.mp4" -vf "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" "$A/hero.gif"
test -s "$A/hero.gif" && rm -rf "$A/hero-raw.mp4" "$F"
ls -la "$A/hero.mp4" "$A/hero.gif" | awk '{print $5, $9}'
cat "$A/hero.log"
