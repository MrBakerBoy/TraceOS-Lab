package nats

import (
	"testing"
)

func TestLogBus_Publish(t *testing.T) {
	bus := NewLogBus()

	event := SubmissionCreatedEvent{
		SubmissionID: "sub-1",
		ExperimentID: "exp-1",
		StudentID:    "stu-1",
		Code:         "int main(){}",
		Language:     "c",
	}

	err := PublishSubmissionCreated(bus, event)
	if err != nil {
		t.Errorf("PublishSubmissionCreated: %v", err)
	}

	err = PublishEvaluationCompleted(bus, EvaluationCompletedEvent{
		SubmissionID: "sub-1",
		Score:        100,
		Status:       "completed",
	})
	if err != nil {
		t.Errorf("PublishEvaluationCompleted: %v", err)
	}

	err = PublishDiagnosisCompleted(bus, DiagnosisCompletedEvent{
		SubmissionID: "sub-1",
		DiagnosisID:  "diag-1",
		ErrorType:    "compile_error",
	})
	if err != nil {
		t.Errorf("PublishDiagnosisCompleted: %v", err)
	}
}

func TestLogBus_Subscribe(t *testing.T) {
	bus := NewLogBus()
	err := bus.Subscribe("test.subject", func(data []byte) {})
	if err != nil {
		t.Errorf("Subscribe: %v", err)
	}
}

func TestLogBus_Close(t *testing.T) {
	bus := NewLogBus()
	bus.Close() // Should not panic
}
