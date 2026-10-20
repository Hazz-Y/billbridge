package main

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strconv"
	"strings"
)

// Canonical strings for the double-financing guards (spec 4.6). These MUST match
// shared/src/canonical.ts byte-for-byte.
//
//	invoiceId   = sha256( supplierGstin | buyerGstin | invoiceNumber )          (normalized: trim + upper-case)
//	contentHash = sha256( supplierGstin | buyerGstin | issueDate | faceValuePaise | items )
//	  items     = lineItems normalized (description: trim, lower-case, collapse whitespace), sorted by
//	              description then totalPaise, each "desc~qty~unitPricePaise~totalPaise", joined with ";"
//	  (invoice number is deliberately EXCLUDED so re-issuing under a new number is still caught)

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// isJSWhitespace mirrors the JavaScript \s / String.prototype.trim character class.
func isJSWhitespace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0x00A0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
		return true
	}
	return r >= 0x2000 && r <= 0x200A
}

func jsTrim(s string) string { return strings.TrimFunc(s, isJSWhitespace) }

// NormalizeID = s.trim().toUpperCase()
func NormalizeID(s string) string { return strings.ToUpper(jsTrim(s)) }

// NormalizeDescription = s.trim().toLowerCase().replace(/\s+/g, ' ')
func NormalizeDescription(s string) string {
	return strings.Join(strings.FieldsFunc(strings.ToLower(jsTrim(s)), isJSWhitespace), " ")
}

// InvoiceIdentityString = SUP|BUY|NUM (normalized).
func InvoiceIdentityString(supplierGstin, buyerGstin, invoiceNumber string) string {
	return NormalizeID(supplierGstin) + "|" + NormalizeID(buyerGstin) + "|" + NormalizeID(invoiceNumber)
}

type canonItem struct {
	d       string
	q, u, t int64
}

// InvoiceContentString builds the pipe-delimited content fingerprint input.
func InvoiceContentString(supplierGstin, buyerGstin, issueDate string, faceValuePaise int64, lineItems []LineItem) string {
	items := make([]canonItem, 0, len(lineItems))
	for _, li := range lineItems {
		items = append(items, canonItem{d: NormalizeDescription(li.Description), q: li.Quantity, u: li.UnitPricePaise, t: li.TotalPaise})
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].d != items[j].d {
			return items[i].d < items[j].d
		}
		return items[i].t < items[j].t
	})
	parts := make([]string, 0, len(items))
	for _, it := range items {
		parts = append(parts, it.d+"~"+strconv.FormatInt(it.q, 10)+"~"+strconv.FormatInt(it.u, 10)+"~"+strconv.FormatInt(it.t, 10))
	}
	date := issueDate
	if len(date) > 10 {
		date = date[:10]
	}
	return NormalizeID(supplierGstin) + "|" + NormalizeID(buyerGstin) + "|" + date + "|" + strconv.FormatInt(faceValuePaise, 10) + "|" + strings.Join(parts, ";")
}
