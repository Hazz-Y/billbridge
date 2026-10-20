package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Executes EVERY shared/test-vectors/*.json file against the Go core through the in-memory stub,
// with the exact semantics documented at the top of shared/src/ledger/vectors.ts. The same files
// run against the TypeScript MockLedger under Vitest, which proves the two implementations equal.

type vectorExpect struct {
	Error  *string         `json:"error"`
	Result json.RawMessage `json:"result"`
}

type vectorStep struct {
	ID     string       `json:"id"`
	Caller string       `json:"caller"`
	Fn     string       `json:"fn"`
	Args   []any        `json:"args"`
	Ts     string       `json:"ts"`
	Expect vectorExpect `json:"expect"`
	Events []string     `json:"events"`
	Note   string       `json:"note"`
}

type vectorFile struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Config      map[string]any    `json:"config"`
	Identities  map[string]Caller `json:"identities"`
	Steps       []vectorStep      `json:"steps"`
}

var vectorBaseTs = time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)

func defaultStepTs(i int) string {
	return vectorBaseTs.Add(time.Duration(i) * time.Second).Format(isoTimestampLayout)
}

func decodeNumbers(b []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	return dec.Decode(v)
}

// encodeArg mirrors shared/src/ledger-client.ts encodeArg: strings as-is, numbers/booleans via String(), objects as JSON.
func encodeArg(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case json.Number:
		return x.String()
	case bool:
		return strconv.FormatBool(x)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	default:
		b, _ := json.Marshal(x)
		return string(b)
	}
}

func lookupPath(obj any, path []string) any {
	cur := obj
	for _, p := range path {
		switch c := cur.(type) {
		case map[string]any:
			v, ok := c[p]
			if !ok {
				return nil
			}
			cur = v
		case []any:
			i, err := strconv.Atoi(p)
			if err != nil || i < 0 || i >= len(c) {
				return nil
			}
			cur = c[i]
		default:
			return nil
		}
	}
	return cur
}

// substitute replaces "$<stepId>.<path>" strings (in args AND expected results) with earlier step results.
func substitute(v any, results map[string]any) any {
	switch x := v.(type) {
	case string:
		if strings.HasPrefix(x, "$") {
			parts := strings.Split(x[1:], ".")
			if r, ok := results[parts[0]]; ok && parts[0] != "" {
				return lookupPath(r, parts[1:])
			}
		}
		return x
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = substitute(e, results)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, e := range x {
			out[k] = substitute(e, results)
		}
		return out
	}
	return v
}

func jsonOf(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}

// subsetMismatch: deep SUBSET match. "" when ok, else a description of the first mismatch.
func subsetMismatch(expected, actual any, path string) string {
	switch e := expected.(type) {
	case []any:
		a, ok := actual.([]any)
		if !ok {
			return fmt.Sprintf("%s: expected array, got %s", path, jsonOf(actual))
		}
		if len(e) != len(a) {
			return fmt.Sprintf("%s: expected length %d, got %d", path, len(e), len(a))
		}
		for i := range e {
			if m := subsetMismatch(e[i], a[i], fmt.Sprintf("%s[%d]", path, i)); m != "" {
				return m
			}
		}
		return ""
	case map[string]any:
		a, ok := actual.(map[string]any)
		if !ok {
			return fmt.Sprintf("%s: expected object, got %s", path, jsonOf(actual))
		}
		keys := sortedKeys(e)
		for _, k := range keys {
			av, present := a[k]
			if !present {
				return fmt.Sprintf("%s.%s: expected %s, got undefined", path, k, jsonOf(e[k]))
			}
			if m := subsetMismatch(e[k], av, path+"."+k); m != "" {
				return m
			}
		}
		return ""
	case json.Number:
		an, ok := actual.(json.Number)
		if !ok {
			return fmt.Sprintf("%s: expected %s, got %s", path, e.String(), jsonOf(actual))
		}
		ef, _ := e.Float64()
		af, _ := an.Float64()
		if ef != af {
			return fmt.Sprintf("%s: expected %s, got %s", path, e.String(), an.String())
		}
		return ""
	case nil:
		if actual != nil {
			return fmt.Sprintf("%s: expected null, got %s", path, jsonOf(actual))
		}
		return ""
	case string, bool:
		if expected != actual {
			return fmt.Sprintf("%s: expected %s, got %s", path, jsonOf(expected), jsonOf(actual))
		}
		return ""
	}
	return fmt.Sprintf("%s: unsupported expected type %T", path, expected)
}

// normalize round-trips a Go result through JSON so the comparison sees the exact wire shape.
func normalize(v any) (any, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var out any
	if err := decodeNumbers(b, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func runVector(t *testing.T, file vectorFile) []string {
	t.Helper()
	ledger := newMemLedger()
	results := map[string]any{}
	failures := []string{}
	bootstrapID := "operator1"
	if v, ok := file.Config["bootstrapOperatorId"].(string); ok && v != "" {
		bootstrapID = v
	}
	cfgJSON, err := json.Marshal(file.Config)
	if err != nil {
		t.Fatalf("config marshal: %v", err)
	}
	bootstrap := Caller{MspID: "Org1MSP", Role: "OPERATOR", ParticipantID: bootstrapID}
	if _, _, err := ledger.submit(bootstrap, "InitLedger", []string{string(cfgJSON)}, defaultStepTs(-1)); err != nil {
		t.Fatalf("InitLedger failed: %v", err)
	}

	for i, step := range file.Steps {
		label := fmt.Sprintf("step %d (%s) %s", i, step.ID, step.Fn)
		identity, ok := file.Identities[step.Caller]
		if !ok {
			failures = append(failures, label+": unknown caller alias "+step.Caller)
			continue
		}
		rawArgs, _ := substitute(step.Args, results).([]any)
		args := make([]string, len(rawArgs))
		for j, a := range rawArgs {
			args[j] = encodeArg(a)
		}
		ts := step.Ts
		if ts == "" {
			ts = defaultStepTs(i)
		}
		var actual any
		var errorCode string
		eventTypes := []string{}
		var callErr error
		if IsMutating(step.Fn) {
			var env *EnvelopeEvent
			actual, env, callErr = ledger.submit(identity, step.Fn, args, ts)
			if env != nil {
				for _, e := range env.Events {
					eventTypes = append(eventTypes, e.Type)
				}
			}
		} else {
			actual, callErr = ledger.evaluate(identity, step.Fn, args, ts)
		}
		if callErr != nil {
			le := AsLedgerError(callErr)
			if le == nil {
				failures = append(failures, label+": unexpected throw: "+callErr.Error())
				continue
			}
			errorCode = le.Code
			if errorCode == "ERR_INTERNAL" {
				failures = append(failures, label+": ERR_INTERNAL: "+le.Message)
				continue
			}
			actual = nil
		} else {
			actual, err = normalize(actual)
			if err != nil {
				failures = append(failures, label+": result not JSON-encodable: "+err.Error())
				continue
			}
			if step.ID != "" {
				results[step.ID] = actual
			}
		}
		expectedErr := ""
		if step.Expect.Error != nil {
			expectedErr = *step.Expect.Error
		}
		if expectedErr != errorCode {
			msg := fmt.Sprintf("%s: expected error %s, got %s", label, orNone(expectedErr), orNone(errorCode))
			if callErr != nil {
				msg += " (" + callErr.Error() + ")"
			} else if actual != nil {
				s := jsonOf(actual)
				if len(s) > 200 {
					s = s[:200]
				}
				msg += " (result " + s + ")"
			}
			failures = append(failures, msg)
			continue
		}
		if step.Expect.Result != nil {
			var expected any
			if err := decodeNumbers(step.Expect.Result, &expected); err != nil {
				failures = append(failures, label+": bad expected result JSON: "+err.Error())
				continue
			}
			expected = substitute(expected, results)
			if m := subsetMismatch(expected, actual, "$"); m != "" {
				failures = append(failures, label+": "+m)
			}
		}
		for _, want := range step.Events {
			if !contains(eventTypes, want) {
				failures = append(failures, fmt.Sprintf("%s: expected event %s; got [%s]", label, want, strings.Join(eventTypes, ", ")))
			}
		}
	}
	return failures
}

func orNone(s string) string {
	if s == "" {
		return "none"
	}
	return s
}

func TestSharedVectors(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("..", "..", "shared", "test-vectors", "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(files)
	if len(files) < 8 {
		t.Fatalf("expected at least 8 vector files under shared/test-vectors, found %d", len(files))
	}
	for _, path := range files {
		path := path
		t.Run(filepath.Base(path), func(t *testing.T) {
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var file vectorFile
			if err := decodeNumbers(raw, &file); err != nil {
				t.Fatalf("parse: %v", err)
			}
			failures := runVector(t, file)
			for _, f := range failures {
				t.Error(f)
			}
			if len(failures) == 0 {
				t.Logf("%s: %d steps OK", file.Name, len(file.Steps))
			}
		})
	}
}

// Guards against a vacuous harness: the matcher must actually detect mismatches and substitutions must resolve.
func TestVectorHarnessSelfCheck(t *testing.T) {
	var expected, actual any
	_ = decodeNumbers([]byte(`{"a":1,"b":[{"c":"x"}],"d":null}`), &expected)
	_ = decodeNumbers([]byte(`{"a":1,"b":[{"c":"x","extra":2}],"d":null,"e":5}`), &actual)
	if m := subsetMismatch(expected, actual, "$"); m != "" {
		t.Fatalf("subset should match: %s", m)
	}
	_ = decodeNumbers([]byte(`{"a":2}`), &expected)
	if m := subsetMismatch(expected, actual, "$"); m != "$.a: expected 2, got 1" {
		t.Fatalf("mismatch text: %q", m)
	}
	_ = decodeNumbers([]byte(`{"b":[]}`), &expected)
	if m := subsetMismatch(expected, actual, "$"); !strings.Contains(m, "expected length 0") {
		t.Fatalf("array length: %q", m)
	}
	_ = decodeNumbers([]byte(`{"zz":null}`), &expected)
	if m := subsetMismatch(expected, actual, "$"); !strings.Contains(m, "got undefined") {
		t.Fatalf("missing key: %q", m)
	}
	results := map[string]any{"create": map[string]any{"invoiceId": "abc", "n": json.Number("7")}}
	args := substitute([]any{"$create.invoiceId", "$create.n", "$missing.x", "plain", json.Number("40000000"), true, map[string]any{"k": "$create.invoiceId"}}, results).([]any)
	encoded := make([]string, len(args))
	for i, a := range args {
		encoded[i] = encodeArg(a)
	}
	want := []string{"abc", "7", "$missing.x", "plain", "40000000", "true", `{"k":"abc"}`}
	for i := range want {
		if encoded[i] != want[i] {
			t.Fatalf("arg %d: got %q want %q", i, encoded[i], want[i])
		}
	}
	if defaultStepTs(-1) != "2026-03-01T09:59:59Z" || defaultStepTs(61) != "2026-03-01T10:01:01Z" {
		t.Fatal("defaultStepTs")
	}
}
