# Playwright Setup for Railway

This project is configured to run Playwright in a Railway-friendly way:

- Chromium is installed at build time, not during a request.
- The app reuses one browser instance per process and creates a fresh context per render.
- Screenshots run in headless mode with minimal launch flags, CSS-scale captures, and larger timeout budgets for oversized cards.
- Railway uses `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` through the Dockerfile.
- If you need a system Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

## Railway deployment

Railway will use the root `Dockerfile` for this service.

Build command handled by the Dockerfile:

```bash
pip install -r requirements.txt
python -m playwright install --with-deps chromium
```

Important environment behavior:

```bash
PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
```

The current `Dockerfile` already bakes this into the image, so you should not run Playwright browser installs at request time.

## Local setup

Linux:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install --with-deps chromium
```

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m playwright install chromium
```

Quick verification:

```bash
python -c "from playwright.async_api import async_playwright; print('playwright import ok')"
```

## Runtime model

Use one long-lived browser per process and create a new context for each screenshot job:

- Reuse `browser = playwright.chromium.launch(...)`
- Create `browser.new_context(...)` per job
- Close the context after the screenshot
- Do not call `launch()` inside every request handler

This project already follows that pattern in `app.py`.

## Minimal reusable example

See [playwright_screenshot_example.py](./playwright_screenshot_example.py).

Run it with:

```bash
python playwright_screenshot_example.py
```

If you are using a custom Chromium binary instead of Playwright-managed browsers:

```bash
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
python playwright_screenshot_example.py
```
