package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type WSMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type Connection struct {
	ID         string
	UserID     string
	Experiment string
	Conn       *websocket.Conn
	Send       chan []byte
	closeOnce  sync.Once
}

type Hub struct {
	mu          sync.RWMutex
	connections map[string]map[*Connection]bool
}

func NewHub() *Hub {
	h := &Hub{
		connections: make(map[string]map[*Connection]bool),
	}
	go h.SendHeartbeat(30 * time.Second)
	return h
}

func (h *Hub) AddConnection(conn *Connection) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.connections[conn.Experiment] == nil {
		h.connections[conn.Experiment] = make(map[*Connection]bool)
	}
	h.connections[conn.Experiment][conn] = true
	log.Printf("[WS] user=%s connected to experiment=%s (total: %d)",
		conn.UserID, conn.Experiment, len(h.connections[conn.Experiment]))
}

func (h *Hub) RemoveConnection(conn *Connection) {
	h.mu.Lock()
	defer h.mu.Unlock()

	conns, ok := h.connections[conn.Experiment]
	if !ok {
		return
	}
	delete(conns, conn)
	if len(conns) == 0 {
		delete(h.connections, conn.Experiment)
	}
	log.Printf("[WS] user=%s disconnected from experiment=%s", conn.UserID, conn.Experiment)
}

// Close cleans up the connection resources. Safe to call multiple times.
func (conn *Connection) Close() {
	conn.closeOnce.Do(func() {
		close(conn.Send)
		conn.Conn.Close()
	})
}

func (h *Hub) BroadcastToExperiment(experimentID string, msg WSMessage) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	conns, ok := h.connections[experimentID]
	if !ok {
		return
	}

	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[WS] marshal error: %v", err)
		return
	}

	for conn := range conns {
		select {
		case conn.Send <- data:
		default:
			log.Printf("[WS] send buffer full for user=%s", conn.UserID)
		}
	}
}

func (h *Hub) ConnectionCount(experimentID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.connections[experimentID])
}

func (h *Hub) TotalConnections() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	total := 0
	for _, conns := range h.connections {
		total += len(conns)
	}
	return total
}

func (h *Hub) HandleWebSocket() gin.HandlerFunc {
	return func(c *gin.Context) {
		experimentID := c.Param("id")
		if experimentID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing experiment id"})
			return
		}

		userID := c.GetString("user_id")
		if userID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		wsConn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Printf("[WS] upgrade error: %v", err)
			return
		}

		conn := &Connection{
			ID:         userID + "_" + experimentID + "_" + time.Now().Format("150405"),
			UserID:     userID,
			Experiment: experimentID,
			Conn:       wsConn,
			Send:       make(chan []byte, 256),
		}

		h.AddConnection(conn)

		// Write pump
		go func() {
			defer func() { h.RemoveConnection(conn); conn.Close() }()
			for msg := range conn.Send {
				if err := conn.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					log.Printf("[WS] write error for user=%s: %v", conn.UserID, err)
					return
				}
			}
		}()

		// Read pump
		go func() {
			defer func() { h.RemoveConnection(conn); conn.Close() }()
			conn.Conn.SetReadLimit(4096)
			conn.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			conn.Conn.SetPongHandler(func(string) error {
				conn.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
				return nil
			})
			for {
				_, _, err := conn.Conn.ReadMessage()
				if err != nil {
					if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
						log.Printf("[WS] read error for user=%s: %v", conn.UserID, err)
					}
					return
				}
			}
		}()
	}
}

func (h *Hub) SendHeartbeat(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		h.mu.RLock()
		for _, conns := range h.connections {
			for conn := range conns {
				msg := WSMessage{Type: "heartbeat", Payload: time.Now().Unix()}
				data, _ := json.Marshal(msg)
				select {
				case conn.Send <- data:
				default:
				}
			}
		}
		h.mu.RUnlock()
	}
}
