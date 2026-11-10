package services

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
)

// GeneratePDF takes raw HTML, provisions a headless Chrome instance with server-safe flags,
// waits for the DOM and styles to stabilize, and returns high-resolution PDF bytes.
func GeneratePDF(htmlContent string) ([]byte, error) {
	// 1. Strict timeout context to prevent hung Chrome processes from leaking RAM
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// 2. Production-grade Allocator Options (Crucial for running inside Docker/Linux servers)
	dir, err := osTempDir() // Safe temporary profile dir
	if err != nil {
		log.Printf("[PDF WARNING] Could not create temp dir, falling back to default allocator: %v", err)
	}

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("headless", true),
		chromedp.Flag("no-sandbox", true), // Mandatory for Docker/Linux root execution
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("disable-dev-shm-usage", true), // Overcomes limited resource constraints in containers
		chromedp.Flag("disable-extensions", true),
		chromedp.Flag("hide-scrollbars", true),
		chromedp.Flag("disable-translate", true),
	)

	if dir != "" {
		opts = append(opts, chromedp.UserDataDir(dir))
	}

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

	// Cleanup temp dir
	if dir != "" {
		defer os.RemoveAll(dir)
	}

	if err != nil {
		return nil, fmt.Errorf("pdf generation pipeline failed: %w", err)
	}

	if len(pdfBuffer) == 0 {
		return nil, fmt.Errorf("pdf generation resulted in empty buffer")
	}

	return pdfBuffer, nil
}

// Helper to safely provision a temporary user data directory for Chrome
func osTempDir() (string, error) {
	dir, err := os.MkdirTemp("", "chromedp-profile-*")
	if err != nil {
		return "", err
	}
	return dir, nil
}