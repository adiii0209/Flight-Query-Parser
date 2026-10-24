"""Hotel photos added by hand: uploaded from a device, pasted from the clipboard, or fetched from a pasted image URL.
Every image is validated, shrunk and stored in the database as a JPEG; quotes then refer to it as "u:<id>"."""
import io
import ipaddress
import socket
from urllib.parse import urljoin, urlparse

import requests
from PIL import Image, ImageOps

MAX_UPLOAD_BYTES = 12 * 1024 * 1024
MAX_SIDE = 1600
MAX_REDIRECTS = 3


def _public_host(host):
    """True only if every address the host resolves to is a public one (blocks localhost / private-network fetches)."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return bool(infos)


def fetch_image_url(url):
    """Download an image from a pasted URL. Raises ValueError with a message the agent can read."""
    for _ in range(MAX_REDIRECTS + 1):
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("Paste a full https:// image address.")
        if not _public_host(parsed.hostname):
            raise ValueError("That address cannot be used.")
        try:
            r = requests.get(url, timeout=15, stream=True, allow_redirects=False, headers={"User-Agent": "Mozilla/5.0 (TimeTours trips)"})
        except requests.RequestException:
            raise ValueError("Could not download that image.")
        if r.is_redirect or r.status_code in (301, 302, 303, 307, 308):
            url = urljoin(url, r.headers.get("Location", ""))
            continue
        if r.status_code != 200:
            raise ValueError(f"The image site answered {r.status_code}.")
        body = r.raw.read(MAX_UPLOAD_BYTES + 1, decode_content=True)
        if len(body) > MAX_UPLOAD_BYTES:
            raise ValueError("That image is too large.")
        return body
    raise ValueError("Too many redirects.")


def normalise(raw):
    """Validate raw bytes as an image, fix rotation, shrink, and return (jpeg_bytes, mime)."""
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("That image is too large (12 MB max).")
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        raise ValueError("That file is not a picture.")
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    else:
        img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=84, optimize=True)
    return out.getvalue(), "image/jpeg"
