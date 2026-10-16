'use client';

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

export function setAuthToken(token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem("token", token);
    // Also set as cookie for automatic browser inclusion
    document.cookie = "token=" + encodeURIComponent(token) + "; expires=" + new Date(Date.now() + 7*24*60*60*1000).toUTCString() + "; path=/; SameSite=Lax";
  }
}

export function removeAuthToken(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem("token");
    // Clear cookie too
    document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax";
    localStorage.removeItem('user');
  }
}

export function getUser(): any {
  if (typeof window === 'undefined') return null;
  const user = localStorage.getItem('user');
  return user ? JSON.parse(user) : null;
}

export function setUser(user: any): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('user', JSON.stringify(user));
  }
}
