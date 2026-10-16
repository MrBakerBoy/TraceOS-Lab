package repository

import (
	"encoding/json"
	"testing"
)

// TestSyscallTrace_SourceLineSerialization verifies that the SourceLine field
// survives a JSON marshal/unmarshal round-trip.
func TestSyscallTrace_SourceLineSerialization(t *testing.T) {
	lineNum := 42
	trace := SyscallTrace{
		SyscallName: "write",
		PID:         1234,
		SourceLine:  &lineNum,
	}

	data, err := json.Marshal(trace)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded SyscallTrace
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if decoded.SourceLine == nil {
		t.Fatal("expected SourceLine to be non-nil after round-trip")
	}
	if *decoded.SourceLine != 42 {
		t.Errorf("expected SourceLine=42, got %d", *decoded.SourceLine)
	}
}

// TestSyscallTrace_SourceLineOmitEmpty verifies that source_line is omitted
// from JSON when the pointer is nil (omitempty tag).
func TestSyscallTrace_SourceLineOmitEmpty(t *testing.T) {
	trace := SyscallTrace{
		SyscallName: "read",
		PID:         1234,
		// SourceLine is nil
	}

	data, err := json.Marshal(trace)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("unmarshal to map: %v", err)
	}

	if _, exists := raw["source_line"]; exists {
		t.Error("expected source_line to be omitted when nil, but it was present")
	}
}

// TestSyscallTrace_SourceLineZero verifies that SourceLine=0 (pointer set,
// value zero) is still serialized since omitempty only omits nil pointers.
func TestSyscallTrace_SourceLineZero(t *testing.T) {
	lineNum := 0
	trace := SyscallTrace{
		SyscallName: "read",
		PID:         1234,
		SourceLine:  &lineNum,
	}

	data, err := json.Marshal(trace)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("unmarshal to map: %v", err)
	}

	val, exists := raw["source_line"]
	if !exists {
		t.Fatal("expected source_line to be present when set to 0")
	}
	if val.(float64) != 0 {
		t.Errorf("expected source_line=0, got %v", val)
	}
}

// TestSyscallTrace_FullSerialization verifies the full struct with SourceLine
// produces valid JSON containing the field.
func TestSyscallTrace_FullSerialization(t *testing.T) {
	lineNum := 17
	trace := SyscallTrace{
		SyscallName: "mmap",
		PID:         999,
		ReturnValue: 12345678,
		DurationNs:  500,
		SourceLine:  &lineNum,
	}

	data, err := json.Marshal(trace)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	jsonStr := string(data)
	if !contains(jsonStr, "\"source_line\":17") {
		t.Errorf("expected JSON to contain source_line:17, got: %s", jsonStr)
	}
}

// contains is a simple substring check to avoid importing strings.
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsStr(s, substr))
}

func containsStr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
