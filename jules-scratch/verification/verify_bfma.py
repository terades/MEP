from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        # Listen for console events
        page.on("console", lambda msg: print(f"Browser console: {msg.text}"))

        page.goto("http://localhost:3000")

        # Give the page a moment to load and execute scripts
        page.wait_for_timeout(2000)

        # Click the BFMA button
        bfma_button = page.locator("#showBfmaBtn")
        bfma_button.click()

        # Wait for the view to be visible
        bfma_view = page.locator("#bfmaView")
        expect(bfma_view).to_be_visible()

        page.screenshot(path="jules-scratch/verification/bfma_view.png")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
