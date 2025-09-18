import os
from playwright.sync_api import sync_playwright, Page, expect

def verify_bfma_3d_view(page: Page):
    # Get the absolute path to the index.html file
    file_path = os.path.abspath('index.html')

    # Go to the local file
    page.goto(f'file://{file_path}')

    # Click the button to show the BFMA view
    bfma_button = page.locator('#showBfmaBtn')
    bfma_button.click()

    # Wait for the view to be visible
    bfma_view = page.locator('#bfmaView')
    expect(bfma_view).to_be_visible()

    # Click the 3D toggle button
    view_3d_btn = page.locator('#bfmaViewToggle3d')
    expect(view_3d_btn).to_be_visible()
    view_3d_btn.click()

    # Wait for the 3D canvas to appear
    preview_3d = page.locator('#bfmaPreview3d')
    expect(preview_3d).to_be_visible()

    # Wait a moment for the viewer to initialize
    page.wait_for_timeout(500)

    # Click the zoom to fit button
    zoom_btn = page.locator('#bfmaZoom3dButton')
    expect(zoom_btn).to_be_visible()
    zoom_btn.click()

    # The canvas itself might take a moment to re-render
    page.wait_for_timeout(2000) # Wait for 2 seconds for rendering

    # Take a screenshot of the preview card
    preview_card = page.locator('#bfmaView .preview-column .card.preview-card')
    screenshot_path = 'jules-scratch/verification/bfma_3d_view.png'
    preview_card.screenshot(path=screenshot_path)
    print(f"Screenshot saved to {screenshot_path}")

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        verify_bfma_3d_view(page)
        browser.close()

if __name__ == '__main__':
    main()
