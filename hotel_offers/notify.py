"""Best-effort email for new leads, using the same SMTP env vars as the Ownership reminders."""
import logging
import os
import smtplib
import ssl
import threading
from email.message import EmailMessage

log = logging.getLogger(__name__)


def _env(name, default=""):
    return (os.getenv(name) or default).strip()


def smtp_configured():
    return bool(_env("OWNERSHIP_SMTP_HOST") and (_env("OWNERSHIP_SMTP_FROM") or _env("OWNERSHIP_SMTP_USERNAME")))


def _send(recipients, subject, body):
    host, port = _env("OWNERSHIP_SMTP_HOST"), int(_env("OWNERSHIP_SMTP_PORT", "587") or 587)
    sender = _env("OWNERSHIP_SMTP_FROM") or _env("OWNERSHIP_SMTP_USERNAME")
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, ", ".join(recipients), subject
    msg.set_content(body)
    use_ssl = _env("OWNERSHIP_SMTP_USE_SSL", "false").lower() in ("1", "true", "yes", "on")
    use_tls = _env("OWNERSHIP_SMTP_USE_TLS", "true").lower() in ("1", "true", "yes", "on")
    smtp = None
    try:
        smtp = smtplib.SMTP_SSL(host, port, timeout=10) if use_ssl else smtplib.SMTP(host, port, timeout=10)
        if use_tls and not use_ssl:
            smtp.starttls(context=ssl.create_default_context())
        if _env("OWNERSHIP_SMTP_USERNAME"):
            smtp.login(_env("OWNERSHIP_SMTP_USERNAME"), os.getenv("OWNERSHIP_SMTP_PASSWORD") or "")
        smtp.send_message(msg)
    except Exception:
        log.exception("Hotel Offers: lead email failed")
    finally:
        if smtp is not None:
            try:
                smtp.quit()
            except Exception:
                pass


def notify_lead(recipients, offer_title, name, phone, stay=None):
    """Fire and forget so a slow mail server never delays the client's WhatsApp redirect."""
    recipients = [r.strip() for r in (recipients or "").split(",") if r.strip()]
    if not recipients or not smtp_configured():
        return False
    body = f"New lead from the Hotel Offers client page\n\nOffer: {offer_title}\nName: {name}\nPhone: {phone}\n" + (f"Stay: {stay}\n" if stay else "")
    threading.Thread(target=_send, args=(recipients, f"New lead: {name} - {offer_title}", body), daemon=True).start()
    return True
