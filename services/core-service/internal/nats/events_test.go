package nats

import (
	"encoding/json"
	"testing"
)

func TestSubmissionCreatedEvent_JSON(t *testing.T) {
	event := SubmissionCreatedEvent{
		SubmissionID: "sub-123",
		ExperimentID: "exp-456",
		StudentID:    "stu-789",
		Code:         "int main() { return 0; }",
		Language:     "c",
	}

	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded SubmissionCreatedEvent
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if decoded.SubmissionID != event.SubmissionID {
		t.Errorf("SubmissionID = %q, want %q", decoded.SubmissionID, event.SubmissionID)
	}
	if decoded.Language != event.Language {
		t.Errorf("Language = %q, want %q", decoded.Language, event.Language)
	}
}

func TestEvaluationCompletedEvent_JSON(t *testing.T) {
	compileErr := "main.c:5: error: expected ';'"
	execTime := 150

	event := EvaluationCompletedEvent{
		SubmissionID:  "sub-123",
		Score:         80,
		TotalScore:    100,
		PassedCases:   4,
		TotalCases:    5,
		Status:        "completed",
		CompileError:  nil,
		RuntimeError:  nil,
		ExecutionTime: &execTime,
	}

	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded EvaluationCompletedEvent
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if decoded.Score != 80 {
		t.Errorf("Score = %d, want 80", decoded.Score)
	}
	if decoded.ExecutionTime == nil || *decoded.ExecutionTime != 150 {
		t.Errorf("ExecutionTime = %v, want 150", decoded.ExecutionTime)
	}

	// Test with compile error
	event2 := EvaluationCompletedEvent{
		SubmissionID: "sub-123",
		Status:       "failed",
		CompileError: &compileErr,
	}
	data2, _ := json.Marshal(event2)
	var decoded2 EvaluationCompletedEvent
	_ = json.Unmarshal(data2, &decoded2)
	if decoded2.CompileError == nil || *decoded2.CompileError != compileErr {
		t.Errorf("CompileError = %v, want %q", decoded2.CompileError, compileErr)
	}
}

func TestDiagnosisCompletedEvent_JSON(t *testing.T) {
	event := DiagnosisCompletedEvent{
		SubmissionID: "sub-123",
		DiagnosisID:  "diag-456",
		ErrorType:    "runtime_error",
	}

	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded DiagnosisCompletedEvent
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if decoded.ErrorType != "runtime_error" {
		t.Errorf("ErrorType = %q, want %q", decoded.ErrorType, "runtime_error")
	}
}
