package services

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveChromeExecutableUsesConfiguredPath(t *testing.T) {
	browserPath := filepath.Join(t.TempDir(), "browser.exe")
	if err := os.WriteFile(browserPath, []byte("browser"), 0600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CHROME_BIN", browserPath)
	t.Setenv("CHROME_PATH", "")

	got, err := resolveChromeExecutable()
	if err != nil {
		t.Fatalf("resolveChromeExecutable returned an error: %v", err)
	}
	if got != browserPath {
		t.Fatalf("resolveChromeExecutable = %q, want %q", got, browserPath)
	}
}

func TestGeneratePDF(t *testing.T) {
	if _, err := resolveChromeExecutable(); err != nil {
		t.Skip(err)
	}

	pdf, err := GeneratePDF("<html><body><h1>PDF smoke test</h1></body></html>")
	if err != nil {
		t.Fatalf("GeneratePDF returned an error: %v", err)
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF-")) {
		t.Fatalf("GeneratePDF returned data without a PDF signature")
	}
}
