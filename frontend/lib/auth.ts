const TOKEN_KEY = "signflow_access_token";

export function setAuthToken(token: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TOKEN_KEY, token);
  }
}

export function getAuthToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function clearAuthToken() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(TOKEN_KEY);
  }
}

export function requireToken() {
  const token = getAuthToken();
  if (!token && typeof window !== "undefined") {
    window.location.href = "/login";
  }
  return token;
}

