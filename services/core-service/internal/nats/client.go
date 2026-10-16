package nats

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	natstype "github.com/nats-io/nats.go"
)

// EventBus defines the interface for publishing and subscribing to events.
type EventBus interface {
	Publish(subject string, data interface{}) error
	Subscribe(subject string, handler func(data []byte)) error
	Close()
}

// ============================================================================
// LogBus — fallback when NATS is not available
// ============================================================================

type LogBus struct{}

func NewLogBus() *LogBus { return &LogBus{} }

func (b *LogBus) Publish(subject string, data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	log.Printf("[NATS/Publish] subject=%s data=%s", subject, string(jsonData))
	return nil
}

func (b *LogBus) Subscribe(subject string, handler func(data []byte)) error {
	log.Printf("[NATS/Subscribe] subject=%s (LogBus: subscription logged, not active)", subject)
	return nil
}

func (b *LogBus) Close() {}

// ============================================================================
// NatsBus — real NATS + JetStream connection
// ============================================================================

type NatsBus struct {
	conn *natstype.Conn
	js   natstype.JetStreamContext
}

// NewNatsBus connects to NATS, enables JetStream, creates streams, and returns a NatsBus.
func NewNatsBus(url string) (*NatsBus, error) {
	nc, err := natstype.Connect(url,
		natstype.RetryOnFailedConnect(true),
		natstype.MaxReconnects(-1),
		natstype.ReconnectWait(2*time.Second),
		natstype.DisconnectErrHandler(func(_ *natstype.Conn, err error) {
			log.Printf("[NATS] disconnected: %v", err)
		}),
		natstype.ReconnectHandler(func(c *natstype.Conn) {
			log.Printf("[NATS] reconnected to %s", c.ConnectedUrl())
		}),
		natstype.ErrorHandler(func(_ *natstype.Conn, _ *natstype.Subscription, err error) {
			log.Printf("[NATS] async error: %v", err)
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("connect to NATS %s: %w", url, err)
	}
	log.Printf("[NATS] connected to %s", nc.ConnectedUrl())

	// Enable JetStream
	js, err := nc.JetStream()
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("jetstream context: %w", err)
	}

	// Create stream for all TraceOS events (idempotent)
	_, err = js.UpdateStream(&natstype.StreamConfig{
		Name:      "TRACEOS",
		Subjects:  []string{"submission.created", "evaluation.completed", "diagnosis.completed"},
		Retention: natstype.WorkQueuePolicy,
		Storage:   natstype.FileStorage,
		MaxAge:    24 * time.Hour,
	})
	if err != nil {
		// Stream may already exist — that is fine
		log.Printf("[NATS/JetStream] AddStream TRACEOS: %v (may already exist)", err)
	} else {
		log.Printf("[NATS/JetStream] stream TRACEOS ready")
	}

	return &NatsBus{conn: nc, js: js}, nil
}

func (b *NatsBus) Publish(subject string, data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	_, err = b.js.Publish(subject, jsonData)
	return err
}

func (b *NatsBus) Subscribe(subject string, handler func(data []byte)) error {
	_, err := b.js.Subscribe(subject, func(msg *natstype.Msg) {
		handler(msg.Data)
		msg.Ack()
	}, natstype.Durable("core-service"), natstype.ManualAck())
	if err != nil {
		return fmt.Errorf("subscribe %s: %w", subject, err)
	}
	log.Printf("[NATS] subscribed to %s (JetStream durable)", subject)
	return nil
}

func (b *NatsBus) Close() {
	if b.conn != nil {
		b.conn.Drain()
	}
}

// ============================================================================
// Subject constants
// ============================================================================

const (
	SubjectSubmissionCreated   = "submission.created"
	SubjectEvaluationCompleted = "evaluation.completed"
	SubjectDiagnosisCompleted  = "diagnosis.completed"
)

func PublishSubmissionCreated(bus EventBus, event SubmissionCreatedEvent) error {
	return bus.Publish(SubjectSubmissionCreated, event)
}

func PublishEvaluationCompleted(bus EventBus, event EvaluationCompletedEvent) error {
	return bus.Publish(SubjectEvaluationCompleted, event)
}

func PublishDiagnosisCompleted(bus EventBus, event DiagnosisCompletedEvent) error {
	return bus.Publish(SubjectDiagnosisCompleted, event)
}

