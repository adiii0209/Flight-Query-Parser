# ocr.py
# ================================================================
# Passport extraction Blueprint — registers as ocr_bp
# Imported by app.py via: from ocr import ocr_bp
# app.register_blueprint(ocr_bp)
#
# NOTE: This file MUST stay named ocr.py to match app.py's import.
# passporteye's internal skimage warnings are suppressed at the
# bottom of this file — harmless FutureWarnings from their code.
# ================================================================
import contextlib
import logging
import os
import re
import shutil
import sys
import uuid
import warnings
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from flask import Blueprint, request, jsonify, session
from mappings import COUNTRY_CODES

# ── Silence passporteye's internal skimage FutureWarnings ──────────────────────
warnings.filterwarnings("ignore", category=FutureWarning, module="passporteye")
warnings.filterwarnings("ignore", category=FutureWarning, module="skimage")

logger = logging.getLogger(__name__)

# ── Blueprint — this is what app.py imports ─────────────────────────────────────
ocr_bp = Blueprint("ocr", __name__)

# ══════════════════════════════════════════════════════════════════════════════
# OPTIONAL DEPENDENCIES (all fail gracefully with a clear log message)
# ══════════════════════════════════════════════════════════════════════════════

# passporteye — MRZ reading
try:
    from passporteye import read_mrz as _pe_read_mrz
    MRZ_SUPPORTED = True
except ImportError as _e:
    MRZ_SUPPORTED = False
    logger.critical("passporteye not installed → pip install passporteye (%s)", _e)

# Pillow — image preprocessing
try:
    from PIL import Image, ImageFilter, ImageEnhance, ImageOps
    PIL_SUPPORTED = True
except ImportError:
    PIL_SUPPORTED = False
    logger.warning("Pillow not installed → pip install pillow (preprocessing disabled)")

# pytesseract — OCR fallback
try:
    import pytesseract
    pytesseract.get_tesseract_version()  # raises if tesseract binary is missing
    OCR_SUPPORTED = True
    logger.info("Tesseract OCR available.")
except Exception:
    OCR_SUPPORTED = False
    logger.warning("Tesseract not available → pip install pytesseract + install Tesseract binary")

# pdf2image / poppler
try:
    from pdf2image import convert_from_path as _pdf2image_convert
    PDF2IMAGE_AVAILABLE = True
except ImportError:
    PDF2IMAGE_AVAILABLE = False

# PyMuPDF — zero-dependency PDF fallback
try:
    import fitz as _fitz
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False

PDF_SUPPORTED = PDF2IMAGE_AVAILABLE or PYMUPDF_AVAILABLE

# ══════════════════════════════════════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════════════════════════════════════
UPLOAD_FOLDER = os.getenv(
    "UPLOAD_FOLDER",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
)
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB hard cap
ALLOWED_EXTS = {"jpg", "jpeg", "png", "bmp", "tiff", "webp", "pdf"}
DEBUG_MODE_DEFAULT = os.getenv("PASSPORT_DEBUG", "0") == "1"

Path(UPLOAD_FOLDER).mkdir(parents=True, exist_ok=True)

# ══════════════════════════════════════════════════════════════════════════════
# DEBUG COLLECTOR
# Accumulates everything interesting during one request.
# Injected into the JSON response only when ?debug=1 — zero cost otherwise.
# ══════════════════════════════════════════════════════════════════════════════
class DebugCollector:
    def __init__(self, enabled: bool):
        self.enabled = enabled
        self.steps: list[str] = []
        self.ocr_raw_text: str = ""
        self.mrz_raw_dict: dict = {}
        self.regex_matches: list[dict] = []
        self.preprocessing: list[str] = []
        self.warnings: list[str] = []

    # ── write helpers (all no-ops when disabled) ─────────────────────────────
    def step(self, msg: str):
        if self.enabled:
            self.steps.append(msg)
            logger.debug("[STEP] %s", msg)

    def warn(self, msg: str):
        if self.enabled:
            self.warnings.append(msg)
            logger.warning(msg)

    def record_ocr(self, text: str):
        if self.enabled:
            self.ocr_raw_text = text

    def record_mrz_raw(self, raw: dict):
        if self.enabled:
            self.mrz_raw_dict = raw

    def record_regex(self, label: str, pattern: str, text_snippet: str, matched: bool, value: Optional[str]):
        if self.enabled:
            self.regex_matches.append({
                "label": label,
                "pattern": pattern[:120],
                "text_snippet": text_snippet[:200],
                "matched": matched,
                "value": value,
            })

    def record_preprocess(self, variant: str):
        if self.enabled:
            self.preprocessing.append(variant)

    def to_dict(self) -> dict:
        return {
            "steps": self.steps,
            "ocr_raw_text": self.ocr_raw_text,
            "mrz_raw_dict": self.mrz_raw_dict,
            "regex_matches": self.regex_matches,
            "preprocessing": self.preprocessing,
            "warnings": self.warnings,
        }

# ══════════════════════════════════════════════════════════════════════════════
# POPPLER AUTO-DETECTION (Windows + Linux/macOS)
# ══════════════════════════════════════════════════════════════════════════════
_WINDOWS_POPPLER_CANDIDATES = [
    r"C:\Users\user\Downloads\Release-25.12.0-0\poppler-25.12.0\Library\bin",
    r"C:\poppler\bin",
    r"C:\Program Files\poppler\bin",
    r"C:\Program Files\poppler\Library\bin",
    r"C:\Program Files (x86)\poppler\bin",
    r"C:\tools\poppler\bin",
    r"C:\tools\poppler\Library\bin",
]

def _find_poppler() -> Optional[str]:
    # 1. Explicit env override
    env = os.getenv("POPPLER_PATH", "").strip()
    if env and Path(env).is_dir():
        return env
    # 2. Already on system PATH
    if shutil.which("pdftoppm") or shutil.which("pdftoppm.exe"):
        return None  # pdf2image will find it itself
    # 3. Common Windows install paths
    if sys.platform == "win32":
        for c in _WINDOWS_POPPLER_CANDIDATES:
            if (Path(c) / "pdftoppm.exe").exists():
                logger.info("Poppler auto-detected: %s", c)
                return c
    return None

POPPLER_PATH: Optional[str] = _find_poppler()

# ══════════════════════════════════════════════════════════════════════════════
# DATE HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def format_mrz_date(s: Optional[str], is_expiry: bool = False) -> Optional[str]:
    """
    MRZ YYMMDD → YYYY-MM-DD

    Expiry: always 20YY  (all current passports expire in the 2000s)
    DOB:    YY > current 2-digit year → 19YY (born last century)
            YY <= current 2-digit year → 20YY (born this century)
    """
    if not s:
        return None
    digits = re.sub(r"\D", "", s)
    if len(digits) != 6:
        return None
    try:
        yy = int(digits[:2])
        mm = int(digits[2:4])
        dd = int(digits[4:6])
        current_yy = datetime.now().year % 100

        if is_expiry:
            # FIX: Expiry dates are ALWAYS in the 21st century for any
            # currently-valid passport.  Never fall back to 19xx here.
            yyyy = 2000 + yy
        else:
            # Date of birth: if yy is ahead of current 2-digit year,
            # the person was born last century.
            yyyy = 2000 + yy if yy <= current_yy else 1900 + yy

        datetime(yyyy, mm, dd)  # validate calendar date
        return f"{yyyy}-{mm:02d}-{dd:02d}"
    except Exception:
        return None


def format_ocr_date(s: Optional[str], force_21st_century: bool = False) -> Optional[str]:
    """
    Parse freeform OCR date string → ISO 8601 (YYYY-MM-DD), or None.

    force_21st_century=True  →  any 2-digit year is treated as 20YY.
                                 Use this for passport issue / expiry dates.
    force_21st_century=False →  standard heuristic: yy <= current_yy → 20YY,
                                 yy > current_yy → 19YY (e.g. dates of birth).
    """
    if not s:
        return None
    s = s.strip()

    # ── 4-digit year formats (unambiguous) ──────────────────────────────────
    for fmt in (
        "%d %b %Y", "%d %B %Y",
        "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y",
        "%Y/%m/%d", "%Y-%m-%d",
    ):
        with contextlib.suppress(ValueError):
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")

    # ── 2-digit year formats — apply century logic ───────────────────────────
    # Python's strptime maps 00-68 → 2000-2068 and 69-99 → 1969-1999 by
    # default, which is wrong for passport dates.  We override it below.
    current_yy = datetime.now().year % 100
    for fmt in ("%d %b %y", "%d %B %y", "%d/%m/%y", "%d-%m-%y"):
        with contextlib.suppress(ValueError):
            dt = datetime.strptime(s, fmt)
            yy = dt.year % 100
            if force_21st_century:
                yyyy = 2000 + yy
            else:
                yyyy = 2000 + yy if yy <= current_yy else 1900 + yy
            return datetime(yyyy, dt.month, dt.day).strftime("%Y-%m-%d")

    return None


def _infer_issue_date(expiry_str: Optional[str], dob_str: Optional[str]) -> Optional[str]:
    """
    Infer the Date of Issue if it is missing, based on the Expiry Date.
    Logic:
      - If Adult (10-year validity): Issue = Expiry - 10y + 1d
      - If Child (5-year validity): Issue = Expiry - 5y + 1d
    
    Adult/Child inference based on Age at Expiry:
      - Child (issued < 16yo) + 5y validity -> Age at Expiry < 21
      - Adult (issued >= 16yo) + 10y validity -> Age at Expiry >= 26
      - Threshold used: 23 years.
    """
    if not expiry_str:
        return None

    try:
        exp = datetime.strptime(expiry_str, "%Y-%m-%d")
        years = 10  # Default to Adult

        if dob_str:
            try:
                dob = datetime.strptime(dob_str, "%Y-%m-%d")
                age_at_expiry = (exp - dob).days / 365.25
                # Child (< 21 at expiry) vs Adult (>= 26 at expiry). Safe cut-off 23.
                if age_at_expiry < 23:
                    years = 5
            except ValueError:
                pass  # Invalid DOB, default to Adult

        # Subtract years (rough approximation handling leap years)
        try:
            # First subtract years
            new_year = exp.year - years
            # Handle Feb 29 for fixed year subtraction
            if exp.month == 2 and exp.day == 29:
                base_date = datetime(new_year, 2, 28)
            else:
                base_date = datetime(new_year, exp.month, exp.day)
            
            # Add 1 day (Issue = Expiry - 10y + 1d)
            issue_date = base_date + timedelta(days=1)
            return issue_date.strftime("%Y-%m-%d")
        except Exception:
            return None
            
    except ValueError:
        return None


def clean_name(raw: Optional[str]) -> str:
    """
    Strip MRZ filler '<', collapse whitespace, and remove noise.
    Keeps only A-Z, spaces, and hyphens.
    Also removes common OCR noise like 'KKKKKS' (repeated characters).
    """
    if not raw:
        return ""
    # 1. Replace < with space
    s = raw.replace("<", " ")
    # 2. Keep only A-Z, space, hyphen (remove numbers/symbols)
    s = re.sub(r"[^A-Za-z\s\-]", "", s)
    # 3. Collapse multiple spaces
    s = re.sub(r"\s+", " ", s).strip()
    
    # 4. Filter out noise words (words with 3+ identical consecutive characters)
    # e.g. "KKKKKS" -> matches regex ([A-Za-z])\1\1
    def is_noise(word):
        return bool(re.search(r"([A-Za-z])\1\1", word))
        
    parts = s.split()
    clean_parts = [p for p in parts if not is_noise(p)]
    
    return " ".join(clean_parts)

# ══════════════════════════════════════════════════════════════════════════════
# REGEX PATTERNS (OCR visual-zone extraction)
# ══════════════════════════════════════════════════════════════════════════════
_DATE_FRAG = (
    r"([0-9]{1,2}[\s\-/\.][A-Za-z]{3,9}[\s\-/\.][0-9]{2,4}"
    r"|[0-9]{4}[-/][0-9]{2}[-/][0-9]{2})"
)

_ISSUE_PATTERNS = [
    ("issue_label_before",
     rf"(?:date\s+of\s+issue|issue\s+date|issued\s+on|date\s+d['\s]?[eé]mission)"
     rf"\s*[:\-\.]*\s*{_DATE_FRAG}"),
    ("issue_label_after",
     rf"{_DATE_FRAG}\s*/\s*(?:date\s+of\s+issue|issue\s+date)"),
    ("issued_keyword",
     rf"([0-9]{{2}}\s+[A-Z]{{3}}\s+[0-9]{{4}})\s+issued?"),
]

_EXPIRY_PATTERNS = [
    ("expiry_label_before",
     rf"(?:date\s+of\s+expir(?:y|ation)|expiry\s+date|valid\s+until|valid\s+thru|expires?)"
     rf"\s*[:\-\.]*\s*{_DATE_FRAG}"),
    ("expiry_keyword_after",
     rf"([0-9]{{2}}\s+[A-Z]{{3}}\s+[0-9]{{4}})\s+(?:expir|valid)"),
]

_VISUAL_PATTERNS = {
    "surname":          r"(?:surname|last\s+name)\s*[:\-]?\s*([A-Z][A-Za-z\s\-']+)",
    "given_names":      r"(?:given\s+names?|first\s+name)\s*[:\-]?\s*([A-Z][A-Za-z\s\-']+)",
    "passport_number":  r"\b([A-Z]{1,2}[0-9]{6,9})\b",
    "nationality":      r"nationality\s*[:\-]?\s*([A-Za-z]+)",
    "sex":              r"\bsex\s*[:\-]?\s*([MFXmfx])\b",
    "date_of_birth":    (r"(?:date\s+of\s+birth|born)\s*[:\-]?\s*"
                         r"([0-9]{1,2}[\s/\-\.][A-Za-z0-9]{2,3}[\s/\-\.][0-9]{2,4})"),
}

def _match_patterns(text: str, named_patterns: list, dbg: DebugCollector, prefix: str = "") -> Optional[str]:
    """Try each (label, pattern) and record every attempt in debug."""
    for label, pat in named_patterns:
        m = re.search(pat, text, re.IGNORECASE)
        hit = m is not None
        value = m.group(1).strip() if hit else None
        dbg.record_regex(f"{prefix}{label}", pat, text[:150].replace("\n", " "), hit, value)
        if hit:
            return value
    return None

# ══════════════════════════════════════════════════════════════════════════════
# IMAGE PRE-PROCESSING
# ══════════════════════════════════════════════════════════════════════════════
def preprocess_variants(image_path: str, dbg: DebugCollector) -> list[str]:
    """
    Generate 4 preprocessed variants to improve MRZ detection on blurry /
    glared / low-res scans.  Returns temp file paths.
    """
    if not PIL_SUPPORTED:
        dbg.warn("Pillow not installed — skipping image preprocessing")
        return []

    variants: list[str] = []
    base = Path(image_path).stem
    out_dir = str(Path(image_path).parent)

    def _save(img: "Image.Image", suffix: str) -> str:
        p = os.path.join(out_dir, f"{base}_{suffix}.jpg")
        img.save(p, "JPEG", quality=95)
        variants.append(p)
        dbg.record_preprocess(suffix)
        return p

    try:
        orig = Image.open(image_path).convert("RGB")
        w, h = orig.size
        _save(orig.resize((w * 2, h * 2), Image.LANCZOS), "2x_upscale")
        _save(ImageEnhance.Contrast(ImageOps.grayscale(orig)).enhance(2.0).convert("RGB"), "gray_contrast")
        _save(orig.filter(ImageFilter.SHARPEN).filter(ImageFilter.SHARPEN), "double_sharpen")
        _save(ImageOps.autocontrast(ImageOps.grayscale(orig), cutoff=2)
              .filter(ImageFilter.SHARPEN).convert("RGB"), "autocontrast_sharp")
    except Exception:
        logger.exception("Image preprocessing failed for %s", image_path)

    return variants

# ══════════════════════════════════════════════════════════════════════════════
# MRZ PARSING (original image + all preprocessed variants)
# ══════════════════════════════════════════════════════════════════════════════
def parse_mrz(image_path: str, dbg: DebugCollector) -> Optional[dict]:
    if not MRZ_SUPPORTED:
        dbg.warn("passporteye not installed — MRZ parsing unavailable")
        return None

    extra = preprocess_variants(image_path, dbg)
    attempts = [("original", image_path)] + [(v, v) for v in extra]

    try:
        for label, path in attempts:
            dbg.step(f"MRZ attempt → variant: {label}")
            try:
                mrz = _pe_read_mrz(path)
                if not mrz:
                    dbg.step(f"  ✗ no MRZ in {label}")
                    continue

                raw = mrz.to_dict()
                dbg.record_mrz_raw(raw)
                dbg.step(f"  ✓ MRZ found in '{label}'")

                # ───────── NAME SPLITTING FIX ─────────
                surname = clean_name(raw.get("surname"))
                full_given = clean_name(raw.get("names"))
                name_parts = full_given.split()
                first_name = name_parts[0] if len(name_parts) > 0 else ""
                middle_name = " ".join(name_parts[1:]) if len(name_parts) > 1 else ""

                return {
                    "surname":          surname,
                    "first_name":       first_name,
                    "middle_name":      middle_name,
                    "given_names":      full_given,
                    "passport_number":  re.sub(r"[<\s]", "", raw.get("number", "")),
                    "nationality":      re.sub(r"[<\s]", "", raw.get("nationality", "")),
                    "country_code":     re.sub(r"[<\s]", "", raw.get("country", "")),
                    "date_of_birth":    format_mrz_date(raw.get("date_of_birth")),
                    # FIX: is_expiry=True forces 20YY — passports never expire in the 1900s
                    "expiration_date":  format_mrz_date(
                        raw.get("expiration_date") or raw.get("date_of_expiry"),
                        is_expiry=True,
                    ),
                    "sex":              re.sub(r"[<\s]", "", raw.get("sex", "")),
                    "personal_number":  (
                        re.sub("<", "", raw.get("personal_number", "")).strip() or None
                    ),
                    "mrz_type":  raw.get("type", ""),
                    "mrz_valid": raw.get("valid_score"),
                }
            except Exception as exc:
                dbg.warn(f"passporteye exception on '{label}': {exc}")

        dbg.step("MRZ not found in any variant")
        return None

    finally:
        for p in extra:
            with contextlib.suppress(Exception):
                if os.path.exists(p):
                    os.remove(p)

# ══════════════════════════════════════════════════════════════════════════════
# TESSERACT OCR
# ══════════════════════════════════════════════════════════════════════════════
def _run_tesseract(image_path: str, dbg: DebugCollector) -> str:
    """Preprocess image and run Tesseract. Returns raw text string."""
    dbg.step("Running Tesseract OCR")
    img = Image.open(image_path).convert("RGB")
    w, h = img.size
    img = img.resize((w * 2, h * 2), Image.LANCZOS)
    img = ImageEnhance.Contrast(img).enhance(1.5)
    img = img.filter(ImageFilter.SHARPEN)
    text = pytesseract.image_to_string(img, config="--oem 3 --psm 6")
    dbg.record_ocr(text)
    dbg.step(f"OCR complete — {len(text)} characters extracted")
    return text


def extract_dates_via_ocr(image_path: str, dbg: DebugCollector) -> dict:
    """
    Extract issue_date and expiry fallback from the visual zone via OCR.

    Issue date is NEVER present in MRZ, so OCR is the only source.
    Both dates use force_21st_century=True so 2-digit years like "25"
    parse as 2025, never 1925.
    """
    result: dict = {"issue_date": None, "expiration_date_ocr": None}

    if not OCR_SUPPORTED or not PIL_SUPPORTED:
        dbg.warn("OCR unavailable — skipping date extraction")
        return result

    try:
        text = _run_tesseract(image_path, dbg)

        dbg.step("Searching for issue date")
        raw_issue = _match_patterns(text, _ISSUE_PATTERNS, dbg, "issue_")

        dbg.step("Searching for expiry date")
        raw_expiry = _match_patterns(text, _EXPIRY_PATTERNS, dbg, "expiry_")

        # FIX: force_21st_century=True ensures "25 JAN 30" → 2030, not 1930
        result["issue_date"]           = format_ocr_date(raw_issue,  force_21st_century=True)
        result["expiration_date_ocr"]  = format_ocr_date(raw_expiry, force_21st_century=True)

        dbg.step(
            f"Dates found → issue={result['issue_date']} "
            f"expiry_ocr={result['expiration_date_ocr']}"
        )
    except Exception:
        logger.exception("OCR date extraction failed")
        dbg.warn("OCR date extraction threw an exception — see server log")

    return result


def full_ocr_fallback(image_path: str, dbg: DebugCollector) -> Optional[dict]:
    """
    When MRZ is completely unreadable, attempt to extract all fields
    from the printed visual zone via Tesseract.
    """
    if not OCR_SUPPORTED or not PIL_SUPPORTED:
        return None

    dbg.step("Starting full OCR fallback (MRZ unreadable)")
    try:
        text = _run_tesseract(image_path, dbg)
        dbg.step("Matching visual-zone field patterns")

        fields: dict = {}
        for field, pat in _VISUAL_PATTERNS.items():
            m = re.search(pat, text, re.IGNORECASE)
            hit = m is not None
            value = m.group(1).strip() if hit else None
            fields[field] = value
            dbg.record_regex(f"visual_{field}", pat, text[:150].replace("\n", " "), hit, value)

        raw_issue  = _match_patterns(text, _ISSUE_PATTERNS,  dbg, "fallback_issue_")
        raw_expiry = _match_patterns(text, _EXPIRY_PATTERNS, dbg, "fallback_expiry_")

        return {
            "surname":          fields.get("surname"),
            "given_names":      fields.get("given_names"),
            "passport_number":  fields.get("passport_number"),
            "nationality":      COUNTRY_CODES.get(fields.get("nationality"), fields.get("nationality")),
            "country_code":     None,
            # DOB may be in the past — use default heuristic (force_21st_century=False)
            "date_of_birth":    format_ocr_date(fields.get("date_of_birth")),
            "sex":              (fields.get("sex") or "").upper() or None,
            "personal_number":  None,
            "mrz_type":         None,
            "mrz_valid":        False,
            # Issue / expiry always 21st century
            "expiration_date":  format_ocr_date(raw_expiry, force_21st_century=True),
            "date_of_issue":    format_ocr_date(raw_issue,  force_21st_century=True) or _infer_issue_date(
                format_ocr_date(raw_expiry, force_21st_century=True),
                format_ocr_date(fields.get("date_of_birth"))
            ),
            "extraction_method": "OCR_ONLY",
            "warning": "MRZ not detected — OCR only. Please verify all fields.",
        }
    except Exception:
        logger.exception("Full OCR fallback failed")
        dbg.warn("Full OCR fallback threw an exception")
        return None

# ══════════════════════════════════════════════════════════════════════════════
# PDF → JPEG
# ══════════════════════════════════════════════════════════════════════════════
def pdf_to_image(pdf_path: str, out_dir: str, dbg: DebugCollector) -> Optional[str]:
    out = os.path.join(out_dir, Path(pdf_path).stem + "_p1.jpg")

    if PDF2IMAGE_AVAILABLE:
        try:
            dbg.step("PDF → image via pdf2image/poppler")
            kw: dict = dict(first_page=1, last_page=1, dpi=300, fmt="jpeg")
            if POPPLER_PATH:
                kw["poppler_path"] = POPPLER_PATH
            imgs = _pdf2image_convert(pdf_path, **kw)
            if imgs:
                imgs[0].save(out, "JPEG", quality=95)
                dbg.step(f"PDF converted ✓ {out}")
                return out
        except Exception as e:
            dbg.warn(f"pdf2image failed: {e}")

    if PYMUPDF_AVAILABLE:
        try:
            dbg.step("PDF → image via PyMuPDF (fallback)")
            doc = _fitz.open(pdf_path)
            pix = doc.load_page(0).get_pixmap(
                matrix=_fitz.Matrix(4.17, 4.17), alpha=False
            )
            pix.save(out)
            doc.close()
            dbg.step(f"PyMuPDF converted ✓ {out}")
            return out
        except Exception as e:
            dbg.warn(f"PyMuPDF failed: {e}")

    return None

# ══════════════════════════════════════════════════════════════════════════════
# FILE HELPERS
# ══════════════════════════════════════════════════════════════════════════════
def _ext(fn: str) -> str:
    return fn.rsplit(".", 1)[-1].lower() if "." in fn else ""

def _allowed(fn: str) -> bool:
    return _ext(fn) in ALLOWED_EXTS

# ══════════════════════════════════════════════════════════════════════════════
# ROUTE: POST /extract-passport
# ══════════════════════════════════════════════════════════════════════════════
@ocr_bp.route("/extract-passport", methods=["POST"])
def extract_passport():
    """
    POST /extract-passport
    Content-Type: multipart/form-data
    Field: passport  (JPEG / PNG / PDF of passport data page)
    Query params:
        ?debug=1              → embed full debug block in response JSON
        PASSPORT_DEBUG=1      → same, via environment variable

    Success 200:
        surname, given_names, passport_number, nationality, country_code,
        date_of_birth, date_of_issue, expiration_date,
        sex, personal_number, mrz_type, mrz_valid, extraction_method
        [debug] — only when requested

    Errors:
        400  missing field / empty file
        413  file too large
        415  unsupported file type
        422  extraction failed (with diagnostic hint)
    """
    # ── Debug mode ───────────────────────────────────────────────────────────
    debug_on = (
        request.args.get("debug", "0") in ("1", "true", "yes")
        or DEBUG_MODE_DEFAULT
    )
    dbg = DebugCollector(enabled=debug_on)
    dbg.step("Request received")

    # ── 1. Validate upload ───────────────────────────────────────────────────
    if "passport" not in request.files:
        return jsonify({"error": "Field 'passport' is required"}), 400

    file = request.files["passport"]
    if not file or not file.filename:
        return jsonify({"error": "Empty file"}), 400

    if not _allowed(file.filename):
        return jsonify({
            "error": (
                f"Unsupported file type '{_ext(file.filename)}'. "
                f"Allowed: {', '.join(sorted(ALLOWED_EXTS))}"
            )
        }), 415

    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(0)
    if size > MAX_FILE_BYTES:
        return jsonify({
            "error": f"File too large ({size // 1024} KB). Max: {MAX_FILE_BYTES // 1_048_576} MB"
        }), 413

    # ── 2. Save to disk ──────────────────────────────────────────────────────
    uid = str(uuid.uuid4())
    extension = _ext(file.filename)
    upload_path = os.path.join(UPLOAD_FOLDER, f"{uid}.{extension}")
    file.save(upload_path)
    dbg.step(f"Saved upload → {upload_path} ({size} bytes)")

    extra_cleanup: list[str] = []
    try:
        # ── 3. PDF → JPEG ────────────────────────────────────────────────────
        if extension == "pdf":
            if not PDF_SUPPORTED:
                resp = {
                    "error": (
                        "PDF support unavailable. "
                        "Install PyMuPDF (zero-config): pip install pymupdf "
                        "or install poppler + pdf2image: pip install pdf2image"
                    )
                }
                if debug_on:
                    resp["debug"] = dbg.to_dict()
                return jsonify(resp), 422

            image_path = pdf_to_image(upload_path, UPLOAD_FOLDER, dbg)
            if not image_path:
                if PDF2IMAGE_AVAILABLE and not PYMUPDF_AVAILABLE:
                    hint = (
                        "Poppler not found. Download: "
                        "https://github.com/oschwartz10612/poppler-windows/releases "
                        "then add bin\\ to PATH or set the POPPLER_PATH env var. "
                        "Or simply: pip install pymupdf"
                    )
                else:
                    hint = "Both pdf2image and PyMuPDF failed — check server logs."
                resp = {"error": f"PDF conversion failed. {hint}"}
                if debug_on:
                    resp["debug"] = dbg.to_dict()
                return jsonify(resp), 422
            extra_cleanup.append(image_path)
        else:
            image_path = upload_path

        dbg.step(f"Working image: {image_path}")

        # ── 4. MRZ parsing ───────────────────────────────────────────────────
        mrz_data = parse_mrz(image_path, dbg)

        # ── 5. OCR dates (issue date is NEVER in MRZ — OCR only) ────────────
        ocr_dates = extract_dates_via_ocr(image_path, dbg)

        # ── 6. MRZ success ───────────────────────────────────────────────────
        if mrz_data:
            dbg.step("Returning MRZ result")
            resp = {
                "surname":          mrz_data["surname"],
                "given_names":      mrz_data["given_names"],
                "passport_number":  mrz_data["passport_number"],
                "nationality":      COUNTRY_CODES.get(mrz_data["nationality"], mrz_data["nationality"]),
                "country_code":     mrz_data["country_code"],
                "date_of_birth":    mrz_data["date_of_birth"],
                "sex":              mrz_data["sex"],
                "personal_number":  mrz_data["personal_number"],
                "mrz_type":         mrz_data["mrz_type"],
                "mrz_valid":        mrz_data["mrz_valid"],
                # MRZ expiry has check-digit verification; OCR is the fallback
                "expiration_date":  mrz_data["expiration_date"] or ocr_dates["expiration_date_ocr"],
                # Issue date is NEVER in MRZ — always use OCR, or infer from expiry
                "date_of_issue":    ocr_dates["issue_date"] or _infer_issue_date(
                    mrz_data["expiration_date"] or ocr_dates["expiration_date_ocr"],
                    mrz_data["date_of_birth"]
                ),
                "extraction_method": "MRZ" + ("+OCR" if OCR_SUPPORTED else ""),
            }
            if debug_on:
                resp["debug"] = dbg.to_dict()
            return jsonify(resp), 200

        # ── 7. MRZ failed → full OCR fallback ───────────────────────────────
        ocr_result = full_ocr_fallback(image_path, dbg)
        if ocr_result:
            dbg.step("Returning OCR-only result")
            if debug_on:
                ocr_result["debug"] = dbg.to_dict()
            return jsonify(ocr_result), 200

        # ── 8. Total failure ─────────────────────────────────────────────────
        dbg.step("All extraction methods failed")
        resp = {
            "error": (
                "Could not extract passport data. "
                "Upload a clear, well-lit photo of the data page "
                "(the page with two lines of machine-readable text at the bottom). "
                "Avoid glare, blur, and cropping."
            )
        }
        if debug_on:
            resp["debug"] = dbg.to_dict()
        return jsonify(resp), 422

    finally:
        # Always clean up every file we created regardless of outcome
        for p in [upload_path] + extra_cleanup:
            with contextlib.suppress(Exception):
                if p and os.path.exists(p):
                    os.remove(p)