package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
)

var ErrPDFBrowserUnavailable = errors.New("PDF browser unavailable")

// GeneratePDF takes raw HTML, provisions a headless Chrome instance with server-safe flags,
// waits for the DOM and styles to stabilize, and returns high-resolution PDF bytes.
func GeneratePDF(htmlContent string) ([]byte, error) {
	if len(htmlContent) == 0 {
		return nil, fmt.Errorf("PDF template output is empty")
	}
	if len(htmlContent) > 10<<20 {
		return nil, fmt.Errorf("PDF template output exceeds 10 MB")
	}
	chromePath, err := resolveChromeExecutable()
	if err != nil {
		return nil, err
	}

	// 1. Strict timeout context to prevent hung Chrome processes from leaking RAM
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	var chromeOutput bytes.Buffer
	opts := append([]chromedp.ExecAllocatorOption{}, chromedp.DefaultExecAllocatorOptions[:]...)
	opts = append(opts,
		chromedp.ExecPath(chromePath),
		chromedp.CombinedOutput(&chromeOutput),
		chromedp.Flag("headless", true),
		chromedp.Flag("no-sandbox", true), // Mandatory for Docker/Linux root execution
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("disable-dev-shm-usage", true), // Overcomes limited resource constraints in containers
		chromedp.Flag("disable-extensions", true),
		chromedp.Flag("hide-scrollbars", true),
		chromedp.Flag("disable-translate", true),
		chromedp.Flag("remote-debugging-port", "0"),
	)

	allocCtx, allocCancel := chromedp.NewExecAllocator(ctx, opts...)
	defer allocCancel()

	// Create browser context
	taskCtx, taskCancel := chromedp.NewContext(allocCtx)
	defer taskCancel()

	var pdfBuffer []byte

	// 3. Encode HTML into a safe Data URI to bypass frame-tree lookup errors completely
	encodedHTML := base64.StdEncoding.EncodeToString([]byte(htmlContent))
	dataURL := fmt.Sprintf("data:text/html;base64,%s", encodedHTML)

	// 4. Execution Pipeline
	err = chromedp.Run(taskCtx,
		// Navigate directly to the data URI
		chromedp.Navigate(dataURL),

		// Force network idle and wait for body element to ensure all inline assets/styles render
		chromedp.WaitReady("body", chromedp.ByQuery),

		// Micro-sleep to let CSS engines calculate absolute positions and flexbox layouts
		chromedp.ActionFunc(func(ctx context.Context) error {
			time.Sleep(250 * time.Millisecond)
			return nil
		}),

		// 5. Generate High-Fidelity PDF
		chromedp.ActionFunc(func(ctx context.Context) error {
			buf, _, err := page.PrintToPDF().
				WithPrintBackground(true).   // Essential for dark-mode or colored themes
				WithPreferCSSPageSize(true). // Respects CSS @page rules if defined
				WithMarginTop(0.5).          // Inches
				WithMarginBottom(0.5).
				WithMarginLeft(0.5).
				WithMarginRight(0.5).
				WithScale(1.0).
				Do(ctx)

			if err != nil {
				return fmt.Errorf("chromedp print to pdf failed: %w", err)
			}
			pdfBuffer = buf
			return nil
		}),
	)

	if err != nil {
		return nil, fmt.Errorf("pdf generation pipeline failed: %w; Chrome output: %s", err, chromeOutput.String())
	}

	if len(pdfBuffer) == 0 {
		return nil, fmt.Errorf("pdf generation resulted in empty buffer")
	}

	return pdfBuffer, nil
}

func resolveChromeExecutable() (string, error) {
	for _, key := range []string{"CHROME_BIN", "CHROME_PATH"} {
		configuredPath := os.Getenv(key)
		if configuredPath == "" {
			continue
		}
		path, err := exec.LookPath(configuredPath)
		if err != nil {
			return "", fmt.Errorf("%w: %s points to an unavailable executable: %v", ErrPDFBrowserUnavailable, key, err)
		}
		return path, nil
	}

	for _, candidate := range []string{
		"chrome", "chrome.exe", "chromium", "chromium-browser",
		"google-chrome", "google-chrome-stable", "google-chrome-beta",
		"google-chrome-unstable", "headless_shell", "headless-shell",
	} {
		if path, err := exec.LookPath(candidate); err == nil {
			return path, nil
		}
	}

	locations := []string{
		"/usr/bin/google-chrome",
		"/usr/local/bin/chrome",
		"/snap/bin/chromium",
	}
	if runtime.GOOS == "windows" {
		locations = append(locations,
			filepath.Join(os.Getenv("ProgramFiles"), "Google", "Chrome", "Application", "chrome.exe"),
			filepath.Join(os.Getenv("ProgramFiles(x86)"), "Google", "Chrome", "Application", "chrome.exe"),
			filepath.Join(os.Getenv("LOCALAPPDATA"), "Google", "Chrome", "Application", "chrome.exe"),
			filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Local", "Chromium", "Application", "chrome.exe"),
		)
	} else if runtime.GOOS == "darwin" {
		locations = append(locations,
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		)
	}
	for _, location := range locations {
		if info, err := os.Stat(location); err == nil && !info.IsDir() {
			return location, nil
		}
	}

	return "", fmt.Errorf("%w: install Chrome or Chromium, or set CHROME_BIN to its executable path", ErrPDFBrowserUnavailable)
}
