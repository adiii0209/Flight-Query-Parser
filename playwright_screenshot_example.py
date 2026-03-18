import atexit
import os
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright


class ScreenshotService:
    _lock = threading.Lock()
    _playwright = None
    _browser = None

    @classmethod
    def _launch_options(cls):
        launch_options = {
            "headless": True,
            "chromium_sandbox": False,
            "args": [
                "--disable-dev-shm-usage",
            ],
        }
        executable_path = (os.getenv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH") or "").strip()
        if executable_path:
            resolved_path = Path(executable_path)
            if not resolved_path.exists():
                raise FileNotFoundError(
                    f"PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH does not exist: {resolved_path}"
                )
            launch_options["executable_path"] = str(resolved_path)
        return launch_options

    @classmethod
    def browser(cls):
        with cls._lock:
            if cls._browser and cls._browser.is_connected():
                return cls._browser
            if cls._playwright is None:
                cls._playwright = sync_playwright().start()
            cls._browser = cls._playwright.chromium.launch(**cls._launch_options())
            return cls._browser

    @classmethod
    def screenshot(cls, url, output_path):
        context = cls.browser().new_context(viewport={"width": 1280, "height": 720})
        try:
            page = context.new_page()
            page.goto(url, wait_until="networkidle")
            page.screenshot(path=output_path, full_page=True, scale="css")
        finally:
            context.close()

    @classmethod
    def close(cls):
        with cls._lock:
            browser = cls._browser
            playwright = cls._playwright
            cls._browser = None
            cls._playwright = None
        if browser:
            browser.close()
        if playwright:
            playwright.stop()


atexit.register(ScreenshotService.close)


if __name__ == "__main__":
    ScreenshotService.screenshot("https://example.com", "example.png")
    print("Saved screenshot to example.png")
