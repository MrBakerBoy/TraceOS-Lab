package evaluator

import "testing"

func TestCompare_Exact(t *testing.T) {
	r := Compare("hello", "hello", "exact")
	if !r.Match {
		t.Error("exact match should succeed")
	}
	r = Compare("hello", "world", "exact")
	if r.Match {
		t.Error("exact mismatch should fail")
	}
}

func TestCompare_Trim(t *testing.T) {
	r := Compare("  hello\n", "hello", "trim")
	if !r.Match {
		t.Error("trim match should succeed")
	}
	r = Compare("hello", "world", "trim")
	if r.Match {
		t.Error("trim mismatch should fail")
	}
}

func TestCompare_Lines(t *testing.T) {
	r := Compare("b\na\n", "a\nb\n", "lines")
	if !r.Match {
		t.Error("lines match should succeed (sorted)")
	}
}

func TestCompare_Contains(t *testing.T) {
	r := Compare("the answer is 42", "42", "contains")
	if !r.Match {
		t.Error("contains match should succeed")
	}
	r = Compare("hello", "42", "contains")
	if r.Match {
		t.Error("contains mismatch should fail")
	}
}

func TestCompare_Regex(t *testing.T) {
	r := Compare("pid=1234", `pid=\d+`, "regex")
	if !r.Match {
		t.Error("regex match should succeed")
	}
	r = Compare("pid=abc", `pid=\d+`, "regex")
	if r.Match {
		t.Error("regex mismatch should fail")
	}
}
