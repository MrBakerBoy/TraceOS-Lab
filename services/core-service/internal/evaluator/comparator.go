package evaluator

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"sort"
	"strings"
)

// CompareResult holds the output comparison result.
type CompareResult struct {
	Match           bool     `json:"match"`
	Diff            string   `json:"diff,omitempty"`
	MatchedPatterns []string `json:"matched_patterns,omitempty"`
	FailedPatterns  []string `json:"failed_patterns,omitempty"`
}

// Compare compares actual vs expected output using the specified mode.
func Compare(actual, expected string, mode string) *CompareResult {
	switch mode {
	case "exact":
		return compareExact(actual, expected)
	case "trim":
		return compareTrim(actual, expected)
	case "lines":
		return compareLines(actual, expected)
	case "contains":
		return compareContains(actual, expected)
	case "normalized_contains":
		return compareNormalizedContains(actual, expected)
	case "regex":
		return compareRegex(actual, expected)
	case "numeric_range":
		return compareNumericRange(actual, expected)
	case "ordered_patterns":
		return compareOrderedPatterns(actual, expected)
	default:
		return compareNormalizedContains(actual, expected)
	}
}

func compareExact(actual, expected string) *CompareResult {
	if actual == expected {
		return &CompareResult{Match: true}
	}
	return &CompareResult{Match: false, Diff: "exact mismatch"}
}

func compareTrim(actual, expected string) *CompareResult {
	a := strings.TrimSpace(actual)
	e := strings.TrimSpace(expected)
	if a == e {
		return &CompareResult{Match: true}
	}
	return &CompareResult{Match: false, Diff: "trimmed output mismatch"}
}

func compareLines(actual, expected string) *CompareResult {
	aLines := sortLines(strings.TrimSpace(actual))
	eLines := sortLines(strings.TrimSpace(expected))
	if strings.Join(aLines, "\n") == strings.Join(eLines, "\n") {
		return &CompareResult{Match: true}
	}
	return &CompareResult{Match: false, Diff: "sorted lines mismatch"}
}

func compareContains(actual, expected string) *CompareResult {
	if strings.Contains(actual, expected) {
		return &CompareResult{Match: true}
	}
	return &CompareResult{Match: false, Diff: "expected output not found in actual"}
}

// normalizeWhitespace collapses multiple whitespace chars to single space.
func normalizeWhitespace(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\t", " ")
	for strings.Contains(s, "  ") {
		s = strings.ReplaceAll(s, "  ", " ")
	}
	return strings.TrimSpace(s)
}

func compareNormalizedContains(actual, expected string) *CompareResult {
	na := normalizeWhitespace(actual)
	ne := normalizeWhitespace(expected)
	if ne == "" {
		if na == "" {
			return &CompareResult{Match: true}
		}
		return &CompareResult{Match: false, Diff: "expected empty output, got non-empty"}
	}
	if strings.Contains(na, ne) {
		return &CompareResult{Match: true}
	}
	return &CompareResult{Match: false, Diff: fmt.Sprintf("normalized mismatch: expected contains %q in actual %q", ne[:min(len(ne), 100)], na[:min(len(na), 100)])}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func compareRegex(actual, pattern string) *CompareResult {
	re, err := regexp.Compile(pattern)
	if err != nil {
		return &CompareResult{Match: false, Diff: "invalid regex pattern"}
	}
	if re.MatchString(actual) {
		return &CompareResult{Match: true}
	}
	return &CompareResult{Match: false, Diff: "regex pattern not matched"}
}

func sortLines(s string) []string {
	lines := strings.Split(s, "\n")
	sort.Strings(lines)
	return lines
}

// ExpectedPattern describes a single structured output assertion.
type ExpectedPattern struct {
	Mode     string  `json:"mode"`
	Pattern  string  `json:"pattern"`
	Required bool    `json:"required"`
	Min      float64 `json:"min,omitempty"`
	Max      float64 `json:"max,omitempty"`
	Field    string  `json:"field,omitempty"`
}

// CompareStructured runs all expected_patterns against the actual output.
func CompareStructured(actual string, expectedPatternsJSON []byte) *CompareResult {
	if expectedPatternsJSON == nil || len(expectedPatternsJSON) == 0 {
		return &CompareResult{Match: true}
	}

	var patterns []ExpectedPattern
	if err := json.Unmarshal(expectedPatternsJSON, &patterns); err != nil {
		return &CompareResult{Match: false, Diff: fmt.Sprintf("invalid expected_patterns JSON: %v", err)}
	}

	if len(patterns) == 0 {
		return &CompareResult{Match: true}
	}

	result := &CompareResult{Match: true}
	normalizedActual := normalizeWhitespace(actual)
	allRequiredMet := true

	for _, p := range patterns {
		var matched bool
		switch p.Mode {
		case "regex":
			matched = matchRegex(normalizedActual, p.Pattern)
		case "numeric_range":
			matched = matchNumericRange(normalizedActual, p.Pattern, p.Min, p.Max)
		case "contains":
			matched = strings.Contains(normalizedActual, normalizeWhitespace(p.Pattern))
		case "normalized_contains":
			matched = strings.Contains(normalizedActual, normalizeWhitespace(p.Pattern))
		default:
			matched = strings.Contains(normalizedActual, normalizeWhitespace(p.Pattern))
		}

		if matched {
			result.MatchedPatterns = append(result.MatchedPatterns, p.Pattern)
		} else {
			result.FailedPatterns = append(result.FailedPatterns, p.Pattern)
			if p.Required {
				allRequiredMet = false
			}
		}
	}

	if !allRequiredMet {
		result.Match = false
		result.Diff = fmt.Sprintf("%d required pattern(s) not matched: %s",
			len(result.FailedPatterns), strings.Join(result.FailedPatterns, ", "))
	}

	return result
}

func matchRegex(actual, pattern string) bool {
	re, err := regexp.Compile(pattern)
	if err != nil {
		return false
	}
	return re.MatchString(actual)
}

func matchNumericRange(actual, field string, min, max float64) bool {
	var searchRe *regexp.Regexp
	if field != "" {
		searchRe = regexp.MustCompile(fmt.Sprintf(`%s\s*[:=]?\s*([\d.]+)`, regexp.QuoteMeta(field)))
	} else {
		searchRe = regexp.MustCompile(`([\d.]+)`)
	}
	matches := searchRe.FindAllStringSubmatch(actual, -1)
	for _, m := range matches {
		val, err := strconv.ParseFloat(m[1], 64)
		if err == nil && val >= min && val <= max {
			return true
		}
	}
	return false
}

func compareNumericRange(actual, expected string) *CompareResult {
	parts := strings.SplitN(expected, ",", 3)
	if len(parts) < 3 {
		return &CompareResult{Match: false, Diff: "numeric_range expects: field,min,max"}
	}
	minVal, _ := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	maxVal, _ := strconv.ParseFloat(strings.TrimSpace(parts[2]), 64)
	if matchNumericRange(actual, strings.TrimSpace(parts[0]), minVal, maxVal) {
		return &CompareResult{Match: true}
	}
	return &CompareResult{Match: false, Diff: fmt.Sprintf("numeric_range: no value in [%.2f, %.2f]", minVal, maxVal)}
}

func compareOrderedPatterns(actual, expected string) *CompareResult {
	patterns := strings.Split(expected, "\n")
	offset := 0
	na := normalizeWhitespace(actual)
	for _, p := range patterns {
		p = normalizeWhitespace(strings.TrimSpace(p))
		if p == "" {
			continue
		}
		idx := strings.Index(na[offset:], p)
		if idx < 0 {
			disp := p
			if len(disp) > 50 {
				disp = disp[:50]
			}
			return &CompareResult{Match: false, Diff: fmt.Sprintf("ordered_patterns: %q not found after offset %d", disp, offset)}
		}
		offset += idx + len(p)
	}
	return &CompareResult{Match: true}
}
