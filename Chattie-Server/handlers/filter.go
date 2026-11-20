package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"regexp"
	"strings"
	"sync"
)

var (
	socialRegex   *regexp.Regexp
	badWordsRegex *regexp.Regexp

	phoneRegex        = regexp.MustCompile(`(?:\+\d{1,3}[\s().-]?)?(?:\(?\d{3,4}\)?[\s().-]?){2,3}\b`)
	socialLinkRegex   = regexp.MustCompile(`(?i)(?:https?://)?(?:www\.)?(?:instagram\.com|tiktok\.com|facebook\.com|fb\.com|x\.com|twitter\.com|snapchat\.com|whatsapp\.com|wa\.me|t\.me|telegram\.me|discord\.gg|discord\.com|youtube\.com|youtu\.be)/?[^\s]*`)
	socialHandleRegex = regexp.MustCompile(`@[A-Za-z0-9._]{2,30}`)

	// Mutex prevents app crashes if an admin updates words while messages are being sent
	filterMutex sync.RWMutex
)

var defaultSocialWords = []string{
	"discord", "facebook", "instagram", "snapchat", "telegram", "tiktok", "twitter", "whatsapp", "youtube",
}

// Init default fallbacks in case the DB is empty or fails on startup
func init() {
	socialRegex = compileSocialRegex(defaultSocialWords)
	badWordsRegex = regexp.MustCompile(`\b\B`)
}

// ReloadFilters queries the database and recompiles the regex in memory.
// Call this once when your server starts up, and again whenever an admin adds a word.
func ReloadFilters(db *sql.DB) error {
	rows, err := db.Query("SELECT word, category FROM flagged_words")
	if err != nil {
		return fmt.Errorf("load moderation terms: %w", err)
	}

	socialWords := append([]string(nil), defaultSocialWords...)
	var profanityWords []string

	for rows.Next() {
		var word, category string
		if err := rows.Scan(&word, &category); err != nil {
			rows.Close()
			return fmt.Errorf("scan moderation term: %w", err)
		}

		// Escape the word so special characters don't break the regex
		escapedWord := regexp.QuoteMeta(word)

		if category == "social" {
			socialWords = append(socialWords, escapedWord)
		} else if category == "profanity" {
			profanityWords = append(profanityWords, escapedWord)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate moderation terms: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close moderation term rows: %w", err)
	}

	filterMutex.Lock()
	defer filterMutex.Unlock()

	socialRegex = compileSocialRegex(socialWords)

	if len(profanityWords) > 0 {
		badPattern := `(?i)\b(` + strings.Join(profanityWords, "|") + `)\b`
		badWordsRegex = regexp.MustCompile(badPattern)
	} else {
		badWordsRegex = regexp.MustCompile(`\b\B`)
	}

	log.Println("SUCCESS: Moderation filters reloaded from database.")
	return nil
}

func compileSocialRegex(words []string) *regexp.Regexp {
	socialPattern := `(?i)\b(` + strings.Join(words, "|") + `)\b`
	return regexp.MustCompile(socialPattern)
}

// MaskSocialInfo removes socials and phone numbers for Model/Operator accounts
func MaskSocialInfo(text string) (string, bool) {
	filterMutex.RLock()
	defer filterMutex.RUnlock()

	hasSocial := socialRegex.MatchString(text) || socialLinkRegex.MatchString(text)
	hasPhone := phoneRegex.MatchString(text)
	if !hasSocial && !hasPhone {
		return text, false
	}

	if hasSocial {
		text = socialLinkRegex.ReplaceAllString(text, "[REDACTED SOCIAL LINK]")
		text = socialRegex.ReplaceAllString(text, "***")
		text = socialHandleRegex.ReplaceAllString(text, "[REDACTED SOCIAL HANDLE]")
	}
	if hasPhone {
		text = phoneRegex.ReplaceAllString(text, "[REDACTED NUMBER]")
	}
	return text, true
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

func HasBadWords(text string) bool {
	filterMutex.RLock()
	defer filterMutex.RUnlock()
	return badWordsRegex.MatchString(text)
}
