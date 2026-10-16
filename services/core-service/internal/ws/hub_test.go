package ws

import (
	"encoding/json"
	"sync"
	"testing"
)

func TestHub_AddRemoveConnection(t *testing.T) {
	hub := NewHub()

	conn := &Connection{
		ID:         "conn-1",
		UserID:     "user-1",
		Experiment: "exp-1",
		Send:       make(chan []byte, 256),
	}

	hub.AddConnection(conn)
	if hub.ConnectionCount("exp-1") != 1 {
		t.Errorf("ConnectionCount = %d, want 1", hub.ConnectionCount("exp-1"))
	}

	hub.RemoveConnection(conn)
	if hub.ConnectionCount("exp-1") != 0 {
		t.Errorf("ConnectionCount after remove = %d, want 0", hub.ConnectionCount("exp-1"))
	}
}

func TestHub_BroadcastToExperiment(t *testing.T) {
	hub := NewHub()

	conn1 := &Connection{
		ID:         "conn-1",
		UserID:     "user-1",
		Experiment: "exp-1",
		Send:       make(chan []byte, 256),
	}
	conn2 := &Connection{
		ID:         "conn-2",
		UserID:     "user-2",
		Experiment: "exp-1",
		Send:       make(chan []byte, 256),
	}
	conn3 := &Connection{
		ID:         "conn-3",
		UserID:     "user-3",
		Experiment: "exp-2",
		Send:       make(chan []byte, 256),
	}

	hub.AddConnection(conn1)
	hub.AddConnection(conn2)
	hub.AddConnection(conn3)

	msg := WSMessage{
		Type:    "evaluation_completed",
		Payload: map[string]string{"submission_id": "sub-1"},
	}

	hub.BroadcastToExperiment("exp-1", msg)

	// conn1 and conn2 should receive the message
	if len(conn1.Send) != 1 {
		t.Errorf("conn1 received %d messages, want 1", len(conn1.Send))
	}
	if len(conn2.Send) != 1 {
		t.Errorf("conn2 received %d messages, want 1", len(conn2.Send))
	}
	// conn3 should NOT receive the message
	if len(conn3.Send) != 0 {
		t.Errorf("conn3 received %d messages, want 0", len(conn3.Send))
	}

	// Verify message content
	data := <-conn1.Send
	var received WSMessage
	if err := json.Unmarshal(data, &received); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if received.Type != "evaluation_completed" {
		t.Errorf("Type = %q, want %q", received.Type, "evaluation_completed")
	}

	hub.RemoveConnection(conn1)
	hub.RemoveConnection(conn2)
	hub.RemoveConnection(conn3)
}

func TestHub_BroadcastToEmptyExperiment(t *testing.T) {
	hub := NewHub()
	// Should not panic
	hub.BroadcastToExperiment("nonexistent", WSMessage{Type: "test"})
}

func TestHub_ConcurrentAccess(t *testing.T) {
	hub := NewHub()
	var wg sync.WaitGroup

	// Concurrent adds
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			conn := &Connection{
				ID:         "conn-" + string(rune(i)),
				UserID:     "user-1",
				Experiment: "exp-1",
				Send:       make(chan []byte, 256),
			}
			hub.AddConnection(conn)
		}(i)
	}
	wg.Wait()

	// Concurrent broadcasts
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			hub.BroadcastToExperiment("exp-1", WSMessage{Type: "test"})
		}()
	}
	wg.Wait()
}

func TestHub_TotalConnections(t *testing.T) {
	hub := NewHub()
	if hub.TotalConnections() != 0 {
		t.Errorf("TotalConnections = %d, want 0", hub.TotalConnections())
	}

	conn1 := &Connection{ID: "c1", Experiment: "e1", Send: make(chan []byte, 1)}
	conn2 := &Connection{ID: "c2", Experiment: "e2", Send: make(chan []byte, 1)}
	hub.AddConnection(conn1)
	hub.AddConnection(conn2)

	if hub.TotalConnections() != 2 {
		t.Errorf("TotalConnections = %d, want 2", hub.TotalConnections())
	}
}
