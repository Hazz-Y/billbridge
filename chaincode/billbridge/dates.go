package main

import (
	"errors"
	"regexp"
	"time"
)

// Date helpers (shared/src/dates.ts). All ledger timestamps are UTC ISO-8601 without fractional
// seconds ("2006-01-02T15:04:05Z"); invoice dates are YYYY-MM-DD.

const isoTimestampLayout = "2006-01-02T15:04:05Z"

var dateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// IsIsoDate reports whether s is a real calendar date in YYYY-MM-DD form.
func IsIsoDate(s string) bool {
	if !dateRe.MatchString(s) {
		return false
	}
	t, err := time.ParseInLocation("2006-01-02", s, time.UTC)
	if err != nil {
		return false
	}
	return t.Format("2006-01-02") == s
}

// ToEpochSeconds parses a YYYY-MM-DD (at 00:00:00Z) or a full ISO timestamp into UTC epoch seconds.
func ToEpochSeconds(s string) (int64, error) {
	if dateRe.MatchString(s) {
		t, err := time.ParseInLocation("2006-01-02", s, time.UTC)
		if err != nil {
			return 0, errors.New("invalid date: " + s)
		}
		return t.Unix(), nil
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return 0, errors.New("invalid date: " + s)
	}
	return t.Unix(), nil
}

// EpochToIso formats epoch seconds as "2006-01-02T15:04:05Z".
func EpochToIso(sec int64) string { return time.Unix(sec, 0).UTC().Format(isoTimestampLayout) }

func floorDiv(a, b int64) int64 {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

func datePart(s string) string {
	if len(s) > 10 {
		return s[:10]
	}
	return s
}

// DaysBetween returns whole calendar days between the DATE parts of two ISO strings (UTC): date(b) - date(a).
func DaysBetween(a, b string) (int64, error) {
	da, err := ToEpochSeconds(datePart(a))
	if err != nil {
		return 0, err
	}
	db, err := ToEpochSeconds(datePart(b))
	if err != nil {
		return 0, err
	}
	return floorDiv(db-da, 86400), nil
}

// AddDays adds whole days to a YYYY-MM-DD (or ISO timestamp's date part) and returns YYYY-MM-DD.
func AddDays(isoDate string, days int64) (string, error) {
	sec, err := ToEpochSeconds(datePart(isoDate))
	if err != nil {
		return "", err
	}
	return EpochToIso(sec + days*86400)[:10], nil
}
