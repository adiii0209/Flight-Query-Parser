"""Link preview image for a shared trip (WhatsApp, iMessage, Slack...): the cover hotel's photo cropped to 1200x630.
Messengers want a small, absolute, publicly reachable image, so this serves a compact JPEG instead of the full-size photo."""
import io
from collections import OrderedDict

from PIL import Image, ImageOps

SIZE = (1200, 630)
FALLBACK = (29, 58, 49)  # the page's dark green, used when a trip has no photos yet
_cache = OrderedDict()   # (trip id, photo ref) -> jpeg bytes; per worker, small


def cover_ref(groups):
    """The photo to represent the trip: the selected hotel of the first city, else any hotel photo."""
    for g in groups:
        for o in g["options"]:
            if o["key"] != g["selected"]:
                continue
            for line in o["lines"]:
                if line.get("photos"):
                    return line["photos"][0]
    for g in groups:
        for o in g["options"]:
            for line in o["lines"]:
                if line.get("photos"):
                    return line["photos"][0]
    return None


def render(raw):
    """raw: original image bytes, or None for the plain fallback. Returns JPEG bytes at 1200x630."""
    if raw is None:
        img = Image.new("RGB", SIZE, FALLBACK)
    else:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
        img = ImageOps.fit(img.convert("RGB"), SIZE, Image.LANCZOS, centering=(0.5, 0.45))
    for quality in (82, 72, 62, 52):  # WhatsApp skips previews whose image is much over ~300 KB
        out = io.BytesIO()
        img.save(out, "JPEG", quality=quality, optimize=True, progressive=True)
        if out.tell() <= 250 * 1024:
            break
    return out.getvalue()


def cached(key, make):
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    _cache[key] = value = make()
    while len(_cache) > 40:
        _cache.popitem(last=False)
    return value
