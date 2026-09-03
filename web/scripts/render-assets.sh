#!/bin/sh
# web/scripts/render-assets.sh: og.png, apple-touch-icon.png and favicon-32.png from the HTML mocks next to this file.
# Needs Google Chrome. Run from anywhere: sh web/scripts/render-assets.sh
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1200,630 --screenshot=../public/og.png "file://$PWD/og.html" 2>/dev/null
# Chrome will not open a window narrower than ~500 px, so render the icon centred in 600x600 and crop the middle with sips
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=600,600 --screenshot=/tmp/sideload-icon.png "file://$PWD/icon.html" 2>/dev/null
sips -c 180 180 /tmp/sideload-icon.png --out ../public/apple-touch-icon.png >/dev/null
sips -z 32 32 ../public/apple-touch-icon.png --out ../public/favicon-32.png >/dev/null
rm -f /tmp/sideload-icon.png
ls -la ../public/og.png ../public/apple-touch-icon.png ../public/favicon-32.png
