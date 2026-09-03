# web/scripts/round.py: README screenshot finish. Rounds the corners (12 css px at 2x), draws an opaque 1 css px border
# (the site's control hairline flattened onto the page background, so the shot separates from GitHub's light or dark ground)
# and writes WebP with alpha (GitHub renders it; a PNG of the grainy landing is 2 MB, the WebP a fraction).
# Usage: python3 web/scripts/round.py in.png out.webp
import sys
from PIL import Image, ImageDraw
src, dst = sys.argv[1:3]
im = Image.open(src).convert('RGBA')
w, h, r = im.width, im.height, 24
mask = Image.new('L', (w * 4, h * 4), 0)  # 4x supersampled so the curve is antialiased
ImageDraw.Draw(mask).rounded_rectangle((0, 0, w * 4 - 1, h * 4 - 1), radius=r * 4, fill=255)
im.putalpha(mask.resize((w, h), Image.Resampling.LANCZOS))
edge = Image.new('RGBA', (w, h), (0, 0, 0, 0))
ImageDraw.Draw(edge).rounded_rectangle((0, 0, w - 1, h - 1), radius=r, outline=(69, 66, 63, 255), width=2)
im.alpha_composite(edge)
im.save(dst, 'WEBP', quality=90, method=6)
