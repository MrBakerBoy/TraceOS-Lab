package middleware

import (
	"testing"
	"time"
)

func TestRateLimiter_Allow(t *testing.T) {
	rl := newRateLimiter(3, 1*time.Second)

	// First 3 requests should pass
	if !rl.allow("ip-1") {
		t.Error("request 1 should be allowed")
	}
	if !rl.allow("ip-1") {
		t.Error("request 2 should be allowed")
	}
	if !rl.allow("ip-1") {
		t.Error("request 3 should be allowed")
	}

	// 4th request should be blocked
	if rl.allow("ip-1") {
		t.Error("request 4 should be blocked")
	}
}

func TestRateLimiter_DifferentIPs(t *testing.T) {
	rl := newRateLimiter(2, 1*time.Second)

	// IP-1 uses up its limit
	rl.allow("ip-1")
	rl.allow("ip-1")
	if rl.allow("ip-1") {
		t.Error("ip-1 should be blocked after 2 requests")
	}

	// IP-2 should still be allowed
	if !rl.allow("ip-2") {
		t.Error("ip-2 should be allowed")
	}
}

func TestRateLimiter_WindowReset(t *testing.T) {
	rl := newRateLimiter(2, 100*time.Millisecond)

	rl.allow("ip-1")
	rl.allow("ip-1")
	if rl.allow("ip-1") {
		t.Error("should be blocked within window")
	}

	// Wait for window to expire
	time.Sleep(150 * time.Millisecond)
	if !rl.allow("ip-1") {
		t.Error("should be allowed after window reset")
	}
}
