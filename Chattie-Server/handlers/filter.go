package handlers

import (
	"database/sql"
	"log"
	"regexp"
	"strings"
	"sync"
)

var (
	socialRegex   *regexp.Regexp
	badWordsRegex *regexp.Regexp

	// Phone numbers generally follow standard formats, so this stays hardcoded
	phoneRegex = regexp.MustCompile(`(?i)(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}`)

	// Mutex prevents app crashes if an admin updates words while messages are being sent
	filterMutex sync.RWMutex
)

// Init default fallbacks in case the DB is empty or fails on startup
func init() {
	socialRegex = regexp.MustCompile(`(?i)(snapchat|instagram|whatsapp)`)
	badWordsRegex = regexp.MustCompile(`(?i)(bannedword)`)
}

// ReloadFilters queries the database and recompiles the regex in memory.
// Call this once when your server starts up, and again whenever an admin adds a word.
func ReloadFilters(db *sql.DB) {
	rows, err := db.Query("SELECT word, category FROM flagged_words")
	if err != nil {
		log.Printf("ERROR: Failed to load flagged words from DB: %v", err)
		return
	}
	defer rows.Close()

	var socialWords []string
	var profanityWords []string

	for rows.Next() {
		var word, category string
		if err := rows.Scan(&word, &category); err != nil {
			continue
		}

		// Escape the word so special characters don't break the regex
		escapedWord := regexp.QuoteMeta(word)

		if category == "social" {
			socialWords = append(socialWords, escapedWord)
		} else if category == "profanity" {
			profanityWords = append(profanityWords, escapedWord)
		}
	}

	filterMutex.Lock()
	defer filterMutex.Unlock()

	// Compile social regex
	if len(socialWords) > 0 {
		socialPattern := `(?i)\b(` + strings.Join(socialWords, "|") + `)\b`
		socialRegex = regexp.MustCompile(socialPattern)
	}

	// Compile profanity regex
	if len(profanityWords) > 0 {
		badPattern := `(?i)\b(` + strings.Join(profanityWords, "|") + `)\b`
		badWordsRegex = regexp.MustCompile(badPattern)
	}

	log.Println("SUCCESS: Moderation filters reloaded from database.")
}

// MaskSocialInfo removes socials and phone numbers for Model/Operator accounts
func MaskSocialInfo(text string) (string, bool) {
	filterMutex.RLock()
	defer filterMutex.RUnlock()

	flagged := false
	if socialRegex.MatchString(text) || phoneRegex.MatchString(text) {
		flagged = true
		text = socialRegex.ReplaceAllString(text, "***")
		text = phoneRegex.ReplaceAllString(text, "[REDACTED NUMBER]")
	}
	return text, flagged
}

// MaskBadWords removes profanity for standard User accounts
func MaskBadWords(text string) (string, bool) {
	filterMutex.RLock()
	defer filterMutex.RUnlock()

	flagged := false
	if badWordsRegex.MatchString(text) {
		flagged = true
		text = badWordsRegex.ReplaceAllString(text, "***")
	}
	return text, flagged
}
