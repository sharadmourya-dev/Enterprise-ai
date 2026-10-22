import { ISafeUser } from '@enterprise-ai/shared-types';

const REFRESH_TOKEN_KEY = 'enterprise_ai_refresh_token';
const USER_KEY = 'enterprise_ai_user';

class TokenStorageManager {
  // Access token is held strictly in-memory during active sessions to minimize XSS exposure
  private memoryAccessToken: string | null = null;

  public getAccessToken(): string | null {
    return this.memoryAccessToken;
  }

  public setAccessToken(token: string | null): void {
    this.memoryAccessToken = token;
  }

  public getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem(REFRESH_TOKEN_KEY);
    } catch {
      return null;
    }
  }

  public setRefreshToken(token: string | null): void {
    if (typeof window === 'undefined') return;
    try {
      if (token) {
        localStorage.setItem(REFRESH_TOKEN_KEY, token);
      } else {
        localStorage.removeItem(REFRESH_TOKEN_KEY);
      }
    } catch {
      // Storage might be restricted in privacy mode
    }
  }

  public getUser(): ISafeUser | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as ISafeUser) : null;
    } catch {
      return null;
    }
  }

  public setUser(user: ISafeUser | null): void {
    if (typeof window === 'undefined') return;
    try {
      if (user) {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(USER_KEY);
      }
    } catch {
      // Storage restricted
    }
  }

  public clearSession(): void {
    this.memoryAccessToken = null;
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      } catch {
        // Ignore
      }
    }
  }
}

export const TokenStorage = new TokenStorageManager();
